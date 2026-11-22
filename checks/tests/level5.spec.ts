import { expect, test } from '@playwright/test';

const API = process.env.API_URL ?? 'http://127.0.0.1:8081';

test.describe('level-5', () => {
  test.describe.configure({ mode: 'serial' });

  test('Seite liest aus dem Backend', async ({ page, request, baseURL }) => {
    const config = await request.get('/config.json');
    expect(await config.json()).toEqual({ source: 'api' });
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    const source = page.getByTestId('run-source');
    await expect(source).toHaveAttribute('data-source', 'api');
    await expect(source).toHaveText('Backend');
  });

  test('nginx leitet /api/ an das Backend weiter', async ({ request, baseURL }) => {
    const viaProxy = await request.get('/api/health');
    expect(viaProxy.status()).toBe(200);
    expect(viaProxy.headers()['content-type']).toBe('application/json');
    const direct = await request.get(`${API}/api/health`);
    expect(await viaProxy.json()).toEqual(await direct.json());
    const unknown = await request.get('/api/unbekannt');
    expect(unknown.status()).toBe(404);
    const body = await unknown.json();
    expect(typeof body.error).toBe('string');
  });

  test('Gemeldetes Ergebnis erscheint ohne Neuladen', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    const response = await request.post('/api/levels/1/result', {
      data: { checks: [{ name: 'Live', ok: true }], durationMs: 4242 },
    });
    expect(response.status()).toBe(200);
    const card = page.locator('[data-testid="level-card"][data-level="1"]');
    await expect(card.getByTestId('level-duration')).toHaveText('4,2 s', { timeout: 8000 });
    await expect(card).toHaveAttribute('data-status', 'bestanden', { timeout: 8000 });
  });

  test('Backend-Ausfall wird angezeigt', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    await page.route('**/api/levels', async (route) => {
      await route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Ausfall</html>' });
    });
    const notice = page.getByTestId('notice');
    await expect(notice).toHaveAttribute('data-kind', 'unavailable', { timeout: 8000 });
    await expect(page.getByTestId('level-card')).toHaveCount(10);
    for (const card of await page.getByTestId('level-card').all()) {
      await expect(card).toHaveAttribute('data-status', 'offen');
    }
    await page.unroute('**/api/levels');
    await expect(notice).toHaveCount(0, { timeout: 8000 });
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 8000 });
  });

  test('Meldungen über nginx landen in der Historie', async ({ request }) => {
    const response = await request.post('/api/levels/1/result', {
      data: { checks: [{ name: 'Probe über nginx', ok: true }], durationMs: 5151 },
    });
    expect(response.status()).toBe(200);
    const history = await request.get('/api/levels/1/history?limit=1');
    expect(history.status()).toBe(200);
    const body = await history.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].durationMs).toBe(5151);
    expect(body.entries[0].checks).toEqual([{ name: 'Probe über nginx', ok: true }]);
  });
});
