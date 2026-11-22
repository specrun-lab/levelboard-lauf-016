import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loadtest } from '../loadtest.mjs';

const LIVE_URL = process.env.LIVE_URL ?? '';
const RUN_ID = process.env.RUN_ID ?? '';

async function assetPath(request: import('@playwright/test').APIRequestContext) {
  const html = await (await request.get(`${LIVE_URL}/`)).text();
  const match = html.match(/\/assets\/[^"']+\.js/);
  expect(match).not.toBeNull();
  return match![0];
}

test.describe('level-9', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Live-Seite zeigt Kopfzeile und 10 Karten', async ({ page }) => {
    expect(LIVE_URL.startsWith('https://')).toBe(true);
    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('run-id')).toHaveText(RUN_ID);
    await expect(page.getByTestId('run-commit')).toHaveText(/^[0-9a-f]{7}$/);
    await expect(page.getByTestId('level-card')).toHaveCount(10);
  });

  test('Cache- und gzip-Regeln gelten live', async ({ request }) => {
    const index = await request.get(`${LIVE_URL}/`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(index.status()).toBe(200);
    expect(index.headers()['cache-control']).toBe('no-cache');
    expect(index.headers()['content-encoding']).toBe('gzip');
    const asset = await request.get(`${LIVE_URL}${await assetPath(request)}`);
    expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request.get(`${LIVE_URL}/config.json`)).headers()['cache-control']).toBe('no-store');
    expect((await request.get(`${LIVE_URL}/gibt-es-nicht.json`)).status()).toBe(404);
  });

  test('Live-API antwortet laut Spec', async ({ request }) => {
    const health = await request.get(`${LIVE_URL}/api/health`);
    expect(health.status()).toBe(200);
    expect(health.headers()['content-type']).toBe('application/json');
    const levels = await request.get(`${LIVE_URL}/api/levels`);
    expect(levels.status()).toBe(200);
    expect((await levels.json()).levels).toHaveLength(10);
    const unknown = await request.get(`${LIVE_URL}/api/levels/0`);
    expect(unknown.status()).toBe(404);
    expect(typeof (await unknown.json()).error).toBe('string');
    const deleted = await request.delete(`${LIVE_URL}/api/levels`);
    expect(deleted.status()).toBe(405);
    expect(deleted.headers().allow).toBe('GET');
    const empty = await request.post(`${LIVE_URL}/api/levels/1/result`, {
      data: '{ "checks": [] }',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(empty.status()).toBe(400);
    const plain = await request.post(`${LIVE_URL}/api/levels/1/result`, {
      data: '{ "checks": [] }',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(plain.status()).toBe(415);
  });

  test('Meldung erscheint live ohne Neuladen', async ({ page, request }) => {
    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    const response = await request.post(`${LIVE_URL}/api/levels/1/result`, {
      data: { checks: [{ name: 'Live-Probe', ok: true }], durationMs: 4242 },
    });
    expect(response.status()).toBe(200);
    const card = page.locator('[data-testid="level-card"][data-level="1"]');
    await expect(card.getByTestId('level-duration')).toHaveText('4,2 s', { timeout: 8000 });
    const history = await request.get(`${LIVE_URL}/api/levels/1/history?limit=1`);
    const body = await history.json();
    expect(body.entries[0].checks).toEqual([{ name: 'Live-Probe', ok: true }]);
  });

  test('Lasttest: 10 Verbindungen, 30 s, ohne Fehler, p95 unter 1 s', async () => {
    const out = path.resolve(process.cwd(), '.out', 'loadtest.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const result = await loadtest(LIVE_URL);
    fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    expect(result.requests).toBeGreaterThan(0);
    expect(result.errors).toBe(0);
    expect(result.p95Ms).toBeLessThan(1000);
  });
});
