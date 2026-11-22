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

function findFile(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

function collectSpecs(suites: any[], output: any[]) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) output.push(spec);
    collectSpecs(suite.suites, output);
  }
}

test.describe('level-7', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Job images des letzten Laufs ist grün', async () => {
    const run = runFor(head());
    expect(run).toBeTruthy();
    const jobs = gh('api', `repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100`);
    const images = (jobs.jobs ?? []).find((job: { name: string }) => job.name === 'images');
    expect(images).toBeTruthy();
    expect(images.conclusion).toBe('success');
  });

  test('Beide Images liegen öffentlich in der GHCR', async () => {
    const sha = head();
    for (const part of ['frontend', 'backend']) {
      const name = `${REPO}-${part}`;
      const tokenResponse = await fetch(`https://ghcr.io/token?scope=repository:${name}:pull`);
      expect(tokenResponse.ok, `Token ${name}`).toBe(true);
      const token = (await tokenResponse.json()).token;
      expect(typeof token).toBe('string');
      const response = await fetch(`https://ghcr.io/v2/${name}/manifests/${sha}`, {
        method: 'HEAD',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept:
            'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
        },
      });
      expect(response.status, `Manifest ${name}`).toBeGreaterThanOrEqual(200);
      expect(response.status, `Manifest ${name}`).toBeLessThan(300);
    }
  });

  test('Report der Container-Suite enthält nur bestandene Checks', async () => {
    const run = runFor(head());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'levelboard-container-'));
    execFileSync(
      'gh',
      ['run', 'download', String(run.id), '--repo', REPO, '--name', 'levelboard-container-report', '--dir', dir],
      { cwd: projectRoot, stdio: 'pipe' },
    );
    const file = findFile(dir, 'playwright.json');
    expect(file).not.toBeNull();
    const report = JSON.parse(fs.readFileSync(file!, 'utf8'));
    const specs: any[] = [];
    collectSpecs(report.suites, specs);
    expect(specs.length).toBeGreaterThanOrEqual(6);
    for (const spec of specs) {
      expect(spec.ok, spec.title).toBe(true);
      for (const testEntry of spec.tests ?? []) {
        expect(['expected', 'flaky'], spec.title).toContain(testEntry.status);
      }
    }
  });
});
