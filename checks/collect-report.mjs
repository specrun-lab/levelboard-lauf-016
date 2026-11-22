import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function ghApi(endpoint) {
  const output = execFileSync('gh', ['api', endpoint], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

export function localHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** Liefert { runId, url, jobs, totalS } für den CI-Lauf zu repo/sha auf main. */
export function pipelineOf(repo, sha) {
  if (!repo || !sha) throw new Error('Repo oder Commit fehlt');
  const runs = ghApi(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`);
  const run = runs.workflow_runs?.[0];
  if (!run) throw new Error('Kein CI-Lauf gefunden');
  const jobList = ghApi(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
  const jobs = {};
  let latest = null;
  for (const job of jobList.jobs ?? []) {
    if (!job.started_at || !job.completed_at) continue;
    const seconds = Math.round((Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000);
    jobs[job.name] = seconds;
    if (!latest || Date.parse(job.completed_at) > Date.parse(latest)) latest = job.completed_at;
  }
  const start = run.run_started_at ?? run.created_at;
  const totalS = latest && start ? Math.round((Date.parse(latest) - Date.parse(start)) / 1000) : 0;
  return { runId: run.id, url: run.html_url, jobs, totalS };
}

async function manifestFor(name, tag) {
  const tokenResponse = await fetch(`https://ghcr.io/token?scope=repository:${name}:pull`);
  if (!tokenResponse.ok) throw new Error(`GHCR-Token: ${tokenResponse.status}`);
  const tokenBody = await tokenResponse.json();
  const headers = {
    Authorization: `Bearer ${tokenBody.token}`,
    Accept:
      'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
  };
  const response = await fetch(`https://ghcr.io/v2/${name}/manifests/${tag}`, { headers });
  if (!response.ok) throw new Error(`GHCR-Manifest: ${response.status}`);
  return { manifest: await response.json(), headers };
}

/** Summe der Layer-Größen in MB (1 Nachkommastelle), ohne Anmeldung gelesen. */
export async function imageSizeMB(name, tag) {
  const first = await manifestFor(name, tag);
  let layers = first.manifest.layers;
  if (!layers && Array.isArray(first.manifest.manifests)) {
    const entry =
      first.manifest.manifests.find((item) => item.platform?.os === 'linux' && item.platform?.architecture === 'amd64') ??
      first.manifest.manifests.find((item) => item.platform?.architecture === 'amd64') ??
      first.manifest.manifests[0];
    if (!entry) throw new Error('Kein Manifest im Index');
    const tokenResponse = await fetch(`https://ghcr.io/token?scope=repository:${name}:pull`);
    const tokenBody = await tokenResponse.json();
    const response = await fetch(`https://ghcr.io/v2/${name}/manifests/${entry.digest}`, {
      headers: {
        Authorization: `Bearer ${tokenBody.token}`,
        Accept:
          'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
      },
    });
    if (!response.ok) throw new Error(`GHCR-Manifest: ${response.status}`);
    const manifest = await response.json();
    layers = manifest.layers;
  }
  if (!Array.isArray(layers)) throw new Error('Keine Layer im Manifest');
  const bytes = layers.reduce((sum, layer) => sum + (layer.size ?? 0), 0);
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
