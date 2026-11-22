import { fileURLToPath } from 'node:url';

function percentile(sorted, p) {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

async function oneRequest(url, times, errors) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const started = performance.now();
  let failed = false;
  try {
    const response = await fetch(url, { signal: controller.signal });
    await response.text();
    if (response.status !== 200) failed = true;
  } catch {
    failed = true;
  } finally {
    clearTimeout(timer);
    times.push(performance.now() - started);
    if (failed) errors.count += 1;
  }
}

async function loop(base, durationMs, times, errors) {
  let index = 0;
  const started = performance.now();
  while (performance.now() - started < durationMs) {
    const url = index % 2 === 0 ? `${base}/` : `${base}/api/levels`;
    index += 1;
    await oneRequest(url, times, errors);
  }
}

export async function loadtest(base) {
  const cleaned = base.replace(/\/$/, '');
  const times = [];
  const errors = { count: 0 };
  const start = performance.now();
  const loops = Array.from({ length: 10 }, () => loop(cleaned, 30_000, times, errors));
  await Promise.all(loops);
  const elapsedS = (performance.now() - start) / 1000;

  const sorted = [...times].sort((a, b) => a - b);
  return {
    connections: 10,
    durationS: 30,
    requests: times.length,
    errors: errors.count,
    rps: Math.round((times.length / elapsedS) * 10) / 10,
    p50Ms: Math.round(percentile(sorted, 50)),
    p95Ms: Math.round(percentile(sorted, 95)),
    maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const base = process.argv[2];
  if (!base) {
    console.error('Aufruf: node loadtest.mjs <basis-url>');
    process.exit(2);
  }
  console.log(JSON.stringify(await loadtest(base)));
}
