import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve(process.cwd(), '..');

async function assetPath(request: import('@playwright/test').APIRequestContext) {
  const html = await (await request.get('/')).text();
  const match = html.match(/\/assets\/[^"']+\.js/);
  expect(match).not.toBeNull();
  return match![0];
}

test.describe('container', () => {
  test.describe.configure({ mode: 'serial' });

  test('Seite läuft im Container und liest aus dem Backend', async ({ page, request }) => {
    expect(await (await request.get('/config.json')).json()).toEqual({ source: 'api' });
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    const source = page.getByTestId('run-source');
    await expect(source).toHaveAttribute('data-source', 'api');
  });

  test('/api/ wird an den Backend-Container weitergeleitet', async ({ request }) => {
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    expect(health.headers()['content-type']).toBe('application/json');
    expect((await health.json()).status).toBe('ok');
    expect((await request.get('/api/unbekannt')).status()).toBe(404);
  });

  test('Meldung erscheint ohne Neuladen', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    expect(
      (
        await request.post('/api/levels/1/result', {
          data: { checks: [{ name: 'Container-Probe', ok: true }], durationMs: 4242 },
        })
      ).status(),
    ).toBe(200);
    const card = page.locator('[data-testid="level-card"][data-level="1"]');
    await expect(card.getByTestId('level-duration')).toHaveText('4,2 s', { timeout: 8000 });
  });

  test('Daten überstehen einen Neustart des Backend-Containers', async ({ request }) => {
    const before = await (await request.get('/api/levels/1/history?limit=500')).json();
    expect(before.entries.length).toBeGreaterThan(0);
    execFileSync('docker', ['compose', 'restart', 'backend'], {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: 120_000,
    });
    let healthy = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const response = await request.get('/api/health');
        if (response.status() === 200) {
          healthy = true;
          break;
        }
      } catch {
        // weiter warten
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(healthy).toBe(true);
    const after = await (await request.get('/api/levels/1/history?limit=500')).json();
    expect(after).toEqual(before);
  });

  test('Cache- und gzip-Regeln gelten im Container', async ({ request }) => {
    const index = await request.get('/', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(index.status()).toBe(200);
    expect(index.headers()['cache-control']).toBe('no-cache');
    expect(index.headers()['content-encoding']).toBe('gzip');
    expect(index.headers().server).toBe('nginx');
    const asset = await request.get(await assetPath(request));
    expect(asset.status()).toBe(200);
    expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request.get('/config.json')).headers()['cache-control']).toBe('no-store');
    expect((await request.get('/gibt-es-nicht.json')).status()).toBe(404);
  });

  test('Backend-Container läuft nicht als root', () => {
    const uid = execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'id', '-u'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    }).trim();
    expect(uid).not.toBe('0');
  });
});
