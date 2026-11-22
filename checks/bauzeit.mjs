import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const bauzeitPath = path.join(root, 'bauzeit.json');

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(bauzeitPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeFile(data) {
  fs.writeFileSync(bauzeitPath, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Ergänzt bauzeit.json nach den Regeln aus 05-datenmodell.md.
 * levels ist das Array der Level-Objekte aus results.json.
 */
export function updateBauzeit(levels, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nowIso = now.toISOString();
  const data = readFile();
  if (!data.levels || typeof data.levels !== 'object') data.levels = {};
  if (typeof data.start !== 'string' || Number.isNaN(Date.parse(data.start))) {
    data.start = nowIso;
  }

  const reached = (() => {
    let value = 0;
    for (let n = 1; n <= 10; n += 1) {
      const level = levels.find((entry) => entry.level === n);
      if (!level || level.status !== 'bestanden') break;
      value = n;
    }
    return value;
  })();

  let previous = 0;
  for (let n = 1; n <= 10; n += 1) {
    if (!data.levels[String(n)]) break;
    previous = n;
  }

  const frozen = process.env.BAUZEIT_FEST === '1';
  if (reached > previous) {
    const base = data.levels[String(previous)];
    const baseTime =
      previous > 0 && base && typeof base.passedAt === 'string' && !Number.isNaN(Date.parse(base.passedAt))
        ? Date.parse(base.passedAt)
        : Date.parse(data.start);
    const buildS = Math.max(0, Math.round((now.getTime() - baseTime) / 1000));
    if (!frozen) {
      data.levels[String(reached)] = { passedAt: nowIso, buildS };
      for (let n = previous + 1; n < reached; n += 1) {
        data.levels[String(n)] = { passedAt: nowIso, inLevel: reached };
      }
      writeFile(data);
    }
  }

  return data;
}

export function readBauzeit() {
  return readFile();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = readFile();
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}
