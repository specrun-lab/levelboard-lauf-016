import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { imageSizeMB, localHead, pipelineOf } from '../collect-report.mjs';

const API = process.env.API_URL ?? 'http://127.0.0.1:8081';
const LIVE_URL = process.env.LIVE_URL ?? '';
const REPO = process.env.GITHUB_REPO ?? '';
const projectRoot = path.resolve(process.cwd(), '..');
const checksDir = process.cwd();
const berichtPath = path.join(checksDir, '.out', 'bericht.json');

function readBauzeit(): { levels?: Record<string, { buildS?: number; inLevel?: number }> } {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'bauzeit.json'), 'utf8'));
  } catch {
    return {};
  }
}

function formatBuild(info: { buildS?: number; inLevel?: number } | undefined): string {
  if (!info) return '–';
  if (info.inLevel !== undefined) return `in L${String(info.inLevel).padStart(2, '0')}`;
  if (info.buildS === undefined) return '–';
  const seconds = Math.max(0, Math.round(info.buildS));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} min`;
}

function formatCost(value: number | null): string {
  return value === null ? '–' : `${value.toFixed(2).replace('.', ',')} USD`;
}

function formatDecimal(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

function formatTokens(value: number): string {
  return value.toLocaleString('de-CH');
}

function selectedBuild(bericht: any, level: number) {
  return bericht.build[String(level)];
}

test.describe('level-10', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Alle Teile des Berichts sind vorhanden', async () => {
    const head = localHead();
    expect(head).toBeTruthy();
    const pipeline = pipelineOf(REPO, head!);
    for (const job of ['check', 'images', 'deploy']) {
      expect(pipeline.jobs[job], job).toBeGreaterThan(0);
    }
    const frontendMB = await imageSizeMB(`${REPO}-frontend`, head!);
    const backendMB = await imageSizeMB(`${REPO}-backend`, head!);
    expect(frontendMB).toBeGreaterThan(0);
    expect(backendMB).toBeGreaterThan(0);
    const loadtest = JSON.parse(fs.readFileSync(path.join(checksDir, '.out', 'loadtest.json'), 'utf8'));
    expect(loadtest.requests).toBeGreaterThan(0);

    const bauzeit = readBauzeit();
    const now = new Date().toISOString();
    const build: Record<string, { passedAt: string; buildS: number }> = {};
    for (let level = 1; level <= 10; level += 1) {
      const entry = bauzeit.levels?.[String(level)];
      build[String(level)] =
        entry && entry.buildS !== undefined
          ? { passedAt: now, buildS: entry.buildS }
          : { passedAt: now, buildS: 30 + level };
    }

    fs.mkdirSync(path.dirname(berichtPath), { recursive: true });
    fs.writeFileSync(
      berichtPath,
      `${JSON.stringify({ pipeline, images: { frontendMB, backendMB }, loadtest, build }, null, 2)}\n`,
    );
  });

  test('Vollständiger Bericht wird dargestellt', async ({ page }) => {
    const bericht = JSON.parse(fs.readFileSync(berichtPath, 'utf8'));
    const now = new Date().toISOString();
    const usage: any = {
      harness: 'beispiel',
      models: ['modell-a', 'modell-b'],
      measuredAt: now,
      total: { output: 812345, total: 23456789, costUsd: 2.04 },
      levels: {},
    };
    for (let level = 1; level <= 10; level += 1) {
      const entry = selectedBuild(bericht, level);
      usage.levels[String(level)] =
        entry.inLevel !== undefined
          ? { inLevel: entry.inLevel }
          : { output: level * 1234, total: level * 5678, costUsd: level / 100 };
    }

    await page.route('**/api/levels', async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.levels = data.levels.map((level: any) => {
        const metrics: any = { build: selectedBuild(bericht, level.level) };
        if (level.level === 6) metrics.pipeline = bericht.pipeline;
        if (level.level === 7) metrics.images = bericht.images;
        if (level.level === 9) metrics.loadtest = bericht.loadtest;
        return {
          ...level,
          status: 'bestanden',
          checkedAt: now,
          durationMs: 1000,
          checks: [{ name: 'Beispiel', ok: true }],
          metrics,
        };
      });
      await route.fulfill({ response, json: data });
    });
    await page.route('**/api/usage', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(usage),
      });
    });

    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    const report = page.getByTestId('report');
    await expect(report).toHaveAttribute('data-complete', 'true');
    await expect(page.getByTestId('report-reached')).toHaveText('10 / 10');
    await expect(page.getByTestId('report-score')).toHaveText('100 / 100');
    await expect(page.getByTestId('report-complete')).toHaveText('ja');

    const total = Object.values(bericht.build as Record<string, { buildS?: number }>).reduce(
      (sum, entry) => sum + (entry.buildS ?? 0),
      0,
    );
    await expect(page.getByTestId('report-build-time')).toHaveText(formatBuild({ buildS: total }));
    await expect(page.getByTestId('report-p95')).toHaveText(`${Math.round(bericht.loadtest.p95Ms)} ms`);
    await expect(page.getByTestId('report-image-frontend')).toHaveText(
      `${formatDecimal(bericht.images.frontendMB)} MB`,
    );
    await expect(page.getByTestId('report-job-check')).toHaveText(`${Math.round(bericht.pipeline.jobs.check)} s`);
    await expect(page.getByTestId('report-job-images')).toHaveText(`${Math.round(bericht.pipeline.jobs.images)} s`);
    await expect(page.getByTestId('report-job-deploy')).toHaveText(`${Math.round(bericht.pipeline.jobs.deploy)} s`);
    await expect(page.getByTestId('report-pipeline-total')).toHaveText(
      `${Math.round(bericht.pipeline.totalS)} s`,
    );
    await expect(page.getByTestId('report-pipeline-link')).toHaveAttribute('href', bericht.pipeline.url);

    await expect(page.getByTestId('report-harness')).toHaveText('beispiel');
    await expect(page.getByTestId('report-model')).toHaveText('modell-a, modell-b');
    await expect(page.getByTestId('report-tokens-output')).toHaveText(formatTokens(812345));
    await expect(page.getByTestId('report-tokens-total')).toHaveText(formatTokens(23456789));
    await expect(page.getByTestId('report-cost')).toHaveText('2,04 USD');

    for (let level = 1; level <= 10; level += 1) {
      const entry = selectedBuild(bericht, level);
      const card = page.locator(`[data-testid="level-card"][data-level="${level}"]`);
      await expect(card.getByTestId('level-build-time')).toHaveText(formatBuild(entry));
      const row = page.locator(`[data-testid="report-level"][data-level="${level}"]`);
      if (entry.inLevel !== undefined) {
        await expect(row.getByTestId('report-level-cost')).toHaveText(
          `in L${String(entry.inLevel).padStart(2, '0')}`,
        );
        await expect(row.getByTestId('report-level-output')).toHaveText(
          `in L${String(entry.inLevel).padStart(2, '0')}`,
        );
      } else {
        await expect(row.getByTestId('report-level-cost')).toHaveText(formatCost(level / 100));
        await expect(row.getByTestId('report-level-output')).toHaveText(formatTokens(level * 1234));
      }
    }
  });

  test('Teilbericht zeigt fehlende Teile', async ({ page }) => {
    const now = new Date().toISOString();
    await page.route('**/api/levels', async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.levels = data.levels.map((level: any) => {
        if (level.level === 1 || level.level === 2) {
          return {
            ...level,
            status: 'bestanden',
            checkedAt: now,
            durationMs: 100,
            checks: [{ name: 'Beispiel', ok: true }],
            metrics: { build: { passedAt: now, buildS: 42 } },
          };
        }
        return {
          ...level,
          status: 'offen',
          checkedAt: null,
          durationMs: null,
          checks: [],
          metrics: {},
        };
      });
      await route.fulfill({ response, json: data });
    });
    await page.route('**/api/usage', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    const report = page.getByTestId('report');
    await expect(report).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('report-reached')).toHaveText('2 / 10');
    await expect(page.getByTestId('report-complete')).toHaveText('nein');
    await expect(page.getByTestId('report-build-time')).toHaveText('1:24 min');
    await expect(page.getByTestId('report-pipeline-missing')).toHaveText('noch nicht erreicht');
    await expect(page.getByTestId('report-images-missing')).toHaveText('noch nicht erreicht');
    await expect(page.getByTestId('report-loadtest-missing')).toHaveText('noch nicht erreicht');
    await expect(page.getByTestId('report-tokens-missing')).toHaveText('wird nach der Prüfung ergänzt');
    for (let level = 1; level <= 10; level += 1) {
      const row = page.locator(`[data-testid="report-level"][data-level="${level}"]`);
      await expect(row.getByTestId('report-level-cost')).toHaveText('–');
      await expect(row.getByTestId('report-level-output')).toHaveText('–');
    }
  });

  test('Verbrauch wird gespeichert und gelesen', async ({ request }) => {
    const before = await (await request.get(`${API}/api/usage`)).json();
    const example = {
      harness: 'test-harness',
      models: ['test-modell'],
      measuredAt: new Date().toISOString(),
      total: { output: 1234, total: 5678, costUsd: 0.42 },
      levels: { '1': { inLevel: 3 }, '3': { output: 100, total: 200, costUsd: null } },
    };
    try {
      const put = await request.put(`${API}/api/usage`, { data: example });
      expect(put.status()).toBe(200);
      expect(await put.json()).toEqual(example);
      expect(await (await request.get(`${API}/api/usage`)).json()).toEqual(example);

      expect((await request.put(`${API}/api/usage`, { data: [1, 2] })).status()).toBe(400);
      expect(
        (
          await request.put(`${API}/api/usage`, {
            data: '{kaputt',
            headers: { 'Content-Type': 'application/json' },
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await request.put(`${API}/api/usage`, {
            data: '{}',
            headers: { 'Content-Type': 'text/plain' },
          })
        ).status(),
      ).toBe(415);
      expect(
        (
          await request.put(`${API}/api/usage`, {
            data: `{"x":"${'a'.repeat(70_000)}"}`,
            headers: { 'Content-Type': 'application/json' },
          })
        ).status(),
      ).toBe(413);
      const post = await request.post(`${API}/api/usage`, { data: example });
      expect(post.status()).toBe(405);
      expect(post.headers().allow).toContain('PUT');
      expect(await (await request.get(`${API}/api/usage`)).json()).toEqual(example);

      expect((await request.put(`${API}/api/usage`, { data: {} })).status()).toBe(200);
      expect(await (await request.get(`${API}/api/usage`)).json()).toEqual({});
    } finally {
      await request.put(`${API}/api/usage`, { data: before });
    }
  });
});
