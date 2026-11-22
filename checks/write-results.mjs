import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBauzeit, updateBauzeit } from './bauzeit.mjs';
import { imageSizeMB, localHead, pipelineOf } from './collect-report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checksDir = path.join(root, 'checks');
const resultsPath = path.join(root, 'frontend', 'dist', 'results.json');
const playwrightPath = path.join(checksDir, '.out', 'playwright.json');
const loadtestPath = path.join(checksDir, '.out', 'loadtest.json');

const requested = [...new Set(process.argv.slice(2).map((value) => Number(value)))]
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= 10)
  .sort((a, b) => a - b);

if (requested.length === 0) {
  console.error('Aufruf: node write-results.mjs <level> [<level> …]');
  process.exit(2);
}

function walkSuites(suites, visit) {
  for (const suite of suites ?? []) {
    visit(suite);
    walkSuites(suite.suites, visit);
  }
}

function collectSpecs(suite, output) {
  for (const spec of suite.specs ?? []) output.push(spec);
  for (const child of suite.suites ?? []) collectSpecs(child, output);
}

function checksForLevel(n) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(playwrightPath, 'utf8'));
  } catch (error) {
    throw new Error(`Playwright-Report nicht lesbar: ${error.message}`);
  }
  const specs = [];
  walkSuites(report.suites, (suite) => {
    if (suite.title === `level-${n}`) collectSpecs(suite, specs);
  });
  if (specs.length === 0) {
    throw new Error(`Keine Checks für Level ${n} im Playwright-Report gefunden`);
  }
  const checks = [];
  let durationMs = 0;
  for (const spec of specs) {
    const tests = spec.tests ?? [];
    const ok =
      spec.ok === true &&
      tests.length > 0 &&
      tests.every((test) => test.status === 'expected' || test.status === 'flaky');
    checks.push({ name: spec.title, ok });
    for (const test of tests) {
      for (const result of test.results ?? []) {
        durationMs += Number(result.duration) || 0;
      }
    }
  }
  return { checks, durationMs: Math.round(durationMs) };
}

let results;
try {
  results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
} catch (error) {
  console.error(`results.json nicht lesbar: ${error.message}`);
  process.exit(2);
}

const collected = new Map();
try {
  for (const n of requested) collected.set(n, checksForLevel(n));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const smallest = Math.min(...requested);
const now = new Date().toISOString();
let failureLevel = null;
const processed = new Set();

for (const n of requested) {
  if (failureLevel !== null) continue;
  const level = results.levels.find((entry) => entry.level === n);
  const { checks, durationMs } = collected.get(n);
  const allOk = checks.every((check) => check.ok);
  level.status = allOk ? 'bestanden' : 'fehlgeschlagen';
  level.checkedAt = now;
  level.durationMs = durationMs;
  level.checks = checks;
  level.metrics = {};
  processed.add(n);
  if (!allOk) failureLevel = n;
}

for (const level of results.levels) {
  if (level.level <= smallest) continue;
  if (processed.has(level.level) && (failureLevel === null || level.level <= failureLevel)) continue;
  level.status = failureLevel !== null ? 'gesperrt' : 'offen';
  level.checkedAt = null;
  level.durationMs = null;
  level.checks = [];
  level.metrics = {};
}

// Die Bauzeit wird nach dem Feststehen aller Status ergänzt.
const bauzeit = updateBauzeit(results.levels, { now: new Date(now) });

const head = localHead();
const repo = process.env.GITHUB_REPO || null;

function note(level, message) {
  console.error(`Level ${level}: Kennzahl nicht ermittelbar: ${message}`);
}

for (const level of results.levels) {
  if (level.status !== 'bestanden' && level.status !== 'fehlgeschlagen') continue;
  const metrics = {};
  const build = bauzeit.levels?.[String(level.level)];
  if (build) metrics.build = build;

  if (level.level === 6 && level.status === 'bestanden') {
    if (repo && head) {
      try {
        metrics.pipeline = pipelineOf(repo, head);
      } catch (error) {
        note(level.level, `pipeline – ${error.message}`);
      }
    } else {
      note(level.level, 'pipeline – Repo oder Commit fehlt');
    }
  }

  if (level.level === 7 && level.status === 'bestanden') {
    if (repo && head) {
      try {
        const frontendMB = await imageSizeMB(`${repo}-frontend`, head);
        const backendMB = await imageSizeMB(`${repo}-backend`, head);
        metrics.images = { frontendMB, backendMB };
      } catch (error) {
        note(level.level, `images – ${error.message}`);
      }
    } else {
      note(level.level, 'images – Repo oder Commit fehlt');
    }
  }

  if (level.level === 9 && level.status === 'bestanden' && fs.existsSync(loadtestPath)) {
    try {
      metrics.loadtest = JSON.parse(fs.readFileSync(loadtestPath, 'utf8'));
    } catch (error) {
      note(level.level, `loadtest – ${error.message}`);
    }
  }

  level.metrics = metrics;
}

results.run.updatedAt = now;
if (process.env.RUN_ID) results.run.id = process.env.RUN_ID;

fs.writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);

for (const n of requested) {
  const level = results.levels.find((entry) => entry.level === n);
  const count = level.checks.length;
  const suffix = count > 0 ? ` (${level.checks.filter((check) => check.ok).length}/${count} Checks)` : '';
  console.log(`Level ${n}: ${level.status}${suffix}`);
}

async function report(base, n, level, kind) {
  try {
    const response = await fetch(`${base}/api/levels/${n}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checks: level.checks,
        durationMs: level.durationMs,
        metrics: level.metrics,
      }),
    });
    const text = await response.text();
    if (response.status !== 200) {
      return { ok: false, line: `Meldung an ${kind} für Level ${n} fehlgeschlagen: ${response.status} ${text}` };
    }
    return { ok: true, line: `Level ${n} an ${kind} gemeldet` };
  } catch (error) {
    return { ok: false, line: `Meldung an ${kind} für Level ${n} fehlgeschlagen: ${error.message}` };
  }
}

async function reportAll(base, kind) {
  let accepted = true;
  for (const n of requested) {
    const level = results.levels.find((entry) => entry.level === n);
    if (!level || (level.status !== 'bestanden' && level.status !== 'fehlgeschlagen')) break;
    const result = await report(base, n, level, kind);
    console.log(result.line);
    if (!result.ok) {
      accepted = false;
      break;
    }
    if (level.status === 'fehlgeschlagen') break;
  }
  return accepted;
}

let apiOk = true;
if (process.env.REPORT_API === '1') {
  const base = (process.env.API_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
  apiOk = await reportAll(base, 'das Backend');
}

let liveOk = true;
if (process.env.REPORT_LIVE === '1') {
  const base = (process.env.LIVE_URL || '').replace(/\/$/, '');
  if (!base) {
    console.log('Meldung an die Live-API fehlgeschlagen: LIVE_URL fehlt');
    liveOk = false;
  } else {
    liveOk = await reportAll(base, 'die Live-API');
  }
}

process.exit(failureLevel !== null || !apiOk || !liveOk ? 1 : 0);
