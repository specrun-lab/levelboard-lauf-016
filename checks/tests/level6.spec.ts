import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = process.env.GITHUB_REPO ?? '';
const projectRoot = path.resolve(process.cwd(), '..');

function gh(...args: string[]) {
  const output = execFileSync('gh', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

function git(...args: string[]) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function findResults(dir: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findResults(full);
      if (found) return found;
    } else if (entry.name === 'results.json') {
      return full;
    }
  }
  return null;
}

test.describe('level-6', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Repo existiert und ist öffentlich', async () => {
    const repo = gh('api', `repos/${REPO}`);
    expect(repo.full_name).toBe(REPO);
    expect(repo.visibility).toBe('public');
    expect(repo.default_branch).toBe('main');
  });

  test('Lokaler Stand ist gepusht', async () => {
    expect(git('status', '--porcelain')).toBe('');
    const head = git('rev-parse', 'HEAD');
    const branch = gh('api', `repos/${REPO}/branches/main`);
    expect(head).toBe(branch.commit.sha);
  });

  test('Letzter Pipeline-Lauf ist grün', async () => {
    const head = git('rev-parse', 'HEAD');
    const runs = gh(
      'api',
      `repos/${REPO}/actions/workflows/ci.yml/runs?branch=main&head_sha=${head}&per_page=1`,
    );
    const run = runs.workflow_runs?.[0];
    expect(run).toBeTruthy();
    expect(run.status).toBe('completed');
    expect(run.conclusion).toBe('success');
  });

  test('Report enthält Level 1–5 bestanden', async () => {
    const head = git('rev-parse', 'HEAD');
    const runs = gh(
      'api',
      `repos/${REPO}/actions/workflows/ci.yml/runs?branch=main&head_sha=${head}&per_page=1`,
    );
    const run = runs.workflow_runs[0];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'levelboard-report-'));
    execFileSync('gh', ['run', 'download', String(run.id), '--repo', REPO, '--name', 'levelboard-report', '--dir', dir], {
      cwd: projectRoot,
      stdio: 'pipe',
    });
    const file = findResults(dir);
    expect(file, 'results.json im Artefakt').not.toBeNull();
    const results = JSON.parse(fs.readFileSync(file!, 'utf8'));
    for (const level of results.levels.filter((entry: { level: number }) => entry.level <= 5)) {
      expect(level.status, `Level ${level.level}`).toBe('bestanden');
      expect(level.checks.length, `Level ${level.level} Checks`).toBeGreaterThan(0);
    }
  });
});
