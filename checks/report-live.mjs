import fs from 'node:fs';

const [file, baseArg] = process.argv.slice(2);
if (!file || !baseArg) {
  console.error('Aufruf: node report-live.mjs <results.json> <basis-url>');
  process.exit(2);
}
const base = baseArg.replace(/\/$/, '');

let results;
try {
  results = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`results.json nicht lesbar: ${error.message}`);
  process.exit(1);
}

const levels = [...results.levels].sort((a, b) => a.level - b.level);
let reported = 0;

for (const level of levels) {
  if (level.status !== 'bestanden' && level.status !== 'fehlgeschlagen') break;
  if (!Array.isArray(level.checks) || level.checks.length === 0) break;
  let response;
  try {
    response = await fetch(`${base}/api/levels/${level.level}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checks: level.checks, durationMs: level.durationMs }),
    });
  } catch (error) {
    console.error(`Meldung an die Live-API für Level ${level.level} fehlgeschlagen: ${error.message}`);
    process.exit(1);
  }
  const text = await response.text();
  if (response.status < 200 || response.status >= 300) {
    console.error(
      `Meldung an die Live-API für Level ${level.level} fehlgeschlagen: ${response.status} ${text}`,
    );
    process.exit(1);
  }
  reported += 1;
  console.log(`Level ${level.level} an die Live-API gemeldet`);
  if (level.status === 'fehlgeschlagen') break;
}

if (reported === 0) {
  console.error('Keine Meldung an die Live-API gesendet');
  process.exit(1);
}
