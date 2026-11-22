import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const REPO = process.env.GITHUB_REPO ?? '';
const LIVE_URL = process.env.LIVE_URL ?? '';
const RUN_ID = process.env.RUN_ID ?? '';
const projectRoot = path.resolve(process.cwd(), '..');

function gh(...args: string[]) {
  const output = execFileSync('gh', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

function head() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function runFor(sha: string) {
  const runs = gh(
    'api',
    `repos/${REPO}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`,
  );
  return runs.workflow_runs?.[0];
}

test.describe('level-8', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Job deploy des letzten Laufs ist grün', async () => {
    const run = runFor(head());
    expect(run).toBeTruthy();
    const jobs = gh('api', `repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100`);
    const deploy = (jobs.jobs ?? []).find((job: { name: string }) => job.name === 'deploy');
    expect(deploy).toBeTruthy();
    expect(deploy.conclusion).toBe('success');
  });

  test('Live-Seite antwortet über HTTPS', async ({ page }) => {
    expect(LIVE_URL.startsWith('https://')).toBe(true);
    const response = await page.request.get(`${LIVE_URL}/`);
    expect(response.status()).toBe(200);
    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('run-source')).toHaveAttribute('data-source', 'api');
  });

  test('Live-Seite meldet den aktuellen Commit', async ({ page }) => {
    const sha = head();
    const response = await page.request.get(`${LIVE_URL}/api/health`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.commit).toBe(sha);
    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('run-commit')).toHaveText(sha.slice(0, 7));
  });

  test('Live-Seite zeigt die Ergebnisse der Pipeline', async ({ request }) => {
    const response = await request.get(`${LIVE_URL}/api/levels`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.run.id).toBe(RUN_ID);
    for (const level of body.levels.filter((entry: { level: number }) => entry.level <= 5)) {
      expect(level.status, `Level ${level.level}`).toBe('bestanden');
    }
  });
});
