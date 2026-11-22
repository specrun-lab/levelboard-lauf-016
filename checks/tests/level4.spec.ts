import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const API = process.env.API_URL ?? 'http://127.0.0.1:8081';
const projectRoot = path.resolve(process.cwd(), '..');

test.describe('level-4', () => {
  test.describe.configure({ mode: 'serial' });

  test('Meldungen erscheinen in der Historie, neueste zuerst', async ({ request }) => {
    for (const durationMs of [101, 102]) {
      const response = await request.post(`${API}/api/levels/1/result`, {
        data: { checks: [{ name: `Probe ${durationMs}`, ok: true }], durationMs },
      });
      expect(response.status()).toBe(200);
    }
    const response = await request.get(`${API}/api/levels/1/history`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.level).toBe(1);
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    expect(body.entries[0].durationMs).toBe(102);
    expect(body.entries[1].durationMs).toBe(101);
    expect(body.entries[0].id).toBeGreaterThan(body.entries[1].id);
    expect(body.entries[0].status).toBe('bestanden');
  });

  test('Historie begrenzt mit limit', async ({ request }) => {
    const limited = await request.get(`${API}/api/levels/1/history?limit=1`);
    expect(limited.status()).toBe(200);
    const body = await limited.json();
    expect(body.entries).toHaveLength(1);
    for (const limit of ['0', '501']) {
      const response = await request.get(`${API}/api/levels/1/history?limit=${limit}`);
      expect(response.status(), limit).toBe(400);
    }
  });

  test('Daten überstehen einen Neustart des Backends', async ({ request }) => {
    const historyBefore = await (await request.get(`${API}/api/levels/1/history?limit=500`)).json();
    const levelsBefore = await (await request.get(`${API}/api/levels`)).json();
    execFileSync('make', ['restart-backend'], { cwd: projectRoot, stdio: 'pipe' });
    const historyAfter = await (await request.get(`${API}/api/levels/1/history?limit=500`)).json();
    const levelsAfter = await (await request.get(`${API}/api/levels`)).json();
    expect(historyAfter).toEqual(historyBefore);
    expect(levelsAfter).toEqual(levelsBefore);
  });

  test('Abgelehnte Meldungen landen nicht in der Historie', async ({ request }) => {
    const before = await (await request.get(`${API}/api/levels/2/history?limit=500`)).json();
    const failed = await request.post(`${API}/api/levels/1/result`, {
      data: { checks: [{ name: 'Fehler', ok: false }], durationMs: 7 },
    });
    expect(failed.status()).toBe(200);
    const rejected = await request.post(`${API}/api/levels/2/result`, {
      data: { checks: [{ name: 'ok', ok: true }], durationMs: 8 },
    });
    expect(rejected.status()).toBe(409);
    const after = await (await request.get(`${API}/api/levels/2/history?limit=500`)).json();
    expect(after.entries.length).toBe(before.entries.length);
  });

  test('Datenbank hat das vorgegebene Schema', () => {
    const database = new DatabaseSync(path.join(projectRoot, '.run', 'levelboard.db'), {
      readOnly: true,
    });
    try {
      const version = database.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(version.user_version).toBe(1);
      const expected: Record<string, string[]> = {
        levels: ['level', 'status', 'checked_at', 'duration_ms', 'checks', 'metrics'],
        reports: ['id', 'level', 'status', 'checked_at', 'duration_ms', 'checks', 'metrics'],
        meta: ['key', 'value'],
      };
      for (const [table, columns] of Object.entries(expected)) {
        const info = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
        expect(info.map((entry) => entry.name), table).toEqual(columns);
      }
      const count = database.prepare('SELECT COUNT(*) AS n FROM levels').get() as { n: number };
      expect(count.n).toBe(10);
    } finally {
      database.close();
    }
  });
});
