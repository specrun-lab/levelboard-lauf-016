import { expect, test } from '@playwright/test';

async function assetPath(baseURL: string, request: import('@playwright/test').APIRequestContext) {
  const response = await request.get('/');
  const html = await response.text();
  const match = html.match(/\/assets\/[^"']+\.js/);
  expect(match, 'JS-Datei in index.html').not.toBeNull();
  return match![0];
}

test.describe('level-2', () => {
  test('Antwort kommt von nginx', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    expect(response.headers().server).toBe('nginx');
  });

  test('results.json wird nicht zwischengespeichert', async ({ request }) => {
    const response = await request.get('/results.json');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
  });

  test('index.html wird nicht zwischengespeichert', async ({ request }) => {
    const response = await request.get('/');
    expect(response.headers()['cache-control']).toBe('no-cache');
  });

  test('Assets werden ein Jahr zwischengespeichert', async ({ request, baseURL }) => {
    const path = await assetPath(baseURL!, request);
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  test('Fehlende Datei ergibt 404', async ({ request }) => {
    const response = await request.get('/gibt-es-nicht.json');
    expect(response.status()).toBe(404);
  });

  test('Antworten sind gzip-komprimiert', async ({ request, baseURL }) => {
    const path = await assetPath(baseURL!, request);
    for (const url of ['/', path, '/results.json']) {
      const response = await request.get(url, { headers: { 'Accept-Encoding': 'gzip' } });
      expect(response.headers()['content-encoding'], url).toBe('gzip');
    }
  });

  test('Seite funktioniert über nginx', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('level-card')).toHaveCount(10);
    expect(errors).toEqual([]);
  });
});
