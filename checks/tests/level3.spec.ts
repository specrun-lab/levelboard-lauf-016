import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const API = process.env.API_URL ?? 'http://127.0.0.1:8081';

test.describe('level-3', () => {
  test.describe.configure({ mode: 'serial' });

  test('Backend antwortet auf /api/health', async ({ request }) => {
    const response = await request.get(`${API}/api/health`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/json');
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['commit', 'status', 'version']);
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
    expect(body.commit).toBeNull();
  });

  test('GET /api/levels liefert alle 10 Levels im Schema', async ({ request }) => {
    const response = await request.get(`${API}/api/levels`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['levels', 'run']);
    expect(body.levels).toHaveLength(10);
    expect(body.levels.map((level: { level: number }) => level.level)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    for (const level of body.levels) {
      expect(['offen', 'bestanden', 'fehlgeschlagen', 'gesperrt']).toContain(level.status);
      expect(Array.isArray(level.checks)).toBe(true);
      expect(typeof level.title).toBe('string');
    }
  });

  test('Ergebnis melden setzt Status und Zeitpunkt', async ({ request }) => {
    const response = await request.post(`${API}/api/levels/1/result`, {
      data: { checks: [{ name: 'Seite antwortet', ok: true }], durationMs: 10 },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    const level = body.levels[0];
    expect(level.status).toBe('bestanden');
    expect(Number.isNaN(Date.parse(level.checkedAt))).toBe(false);
    expect(level.durationMs).toBe(10);
  });

  test('Fehlschlag sperrt höhere Levels', async ({ request }) => {
    const response = await request.post(`${API}/api/levels/1/result`, {
      data: { checks: [{ name: 'Fehler', ok: false }], durationMs: 5 },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.levels[0].status).toBe('fehlgeschlagen');
    for (const level of body.levels.slice(1)) {
      expect(level.status).toBe('gesperrt');
    }
  });

  test('Falsche Reihenfolge ergibt 409', async ({ request }) => {
    const response = await request.post(`${API}/api/levels/2/result`, {
      data: { checks: [{ name: 'ok', ok: true }], durationMs: 5 },
    });
    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(typeof body.error).toBe('string');
  });

  test('Ungültige Anfragen ergeben 400', async ({ request }) => {
    const cases = [
      { data: '{kaputt', headers: { 'Content-Type': 'application/json' } },
      { data: { durationMs: 1 } },
      { data: { checks: [], durationMs: 1 } },
    ];
    for (const item of cases) {
      const response = await request.post(`${API}/api/levels/1/result`, item);
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(typeof body.error).toBe('string');
    }
  });

  test('Unbekanntes Level ergibt 404', async ({ request }) => {
    for (const path of ['/api/levels/0', '/api/levels/11', '/api/levels/abc']) {
      const response = await request.get(`${API}${path}`);
      expect(response.status(), path).toBe(404);
    }
  });

  test('Go-Tests bestehen', async () => {
    const backend = path.resolve(process.cwd(), '..', 'backend');
    execFileSync('go', ['test', '-count=1', './...'], { cwd: backend, stdio: 'pipe' });
  });
});
