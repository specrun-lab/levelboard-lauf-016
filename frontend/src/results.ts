export const LEVEL_TITLES = [
  'Statische Seite',
  'Webserver',
  'REST-Backend',
  'Datenbank',
  'Frontend + Backend',
  'Repo + CI',
  'Images in der Pipeline',
  'Deployment',
  'Live-Prüfung',
  'Metriken veröffentlicht',
] as const;

export type Status = 'offen' | 'bestanden' | 'fehlgeschlagen' | 'gesperrt';
export type LoadState = 'loading' | 'ok' | 'missing' | 'invalid' | 'unavailable';
export type Source = 'loading' | 'file' | 'api';

export interface Check {
  name: string;
  ok: boolean;
}

export interface LevelResult {
  level: number;
  title: string;
  status: Status;
  checkedAt: string | null;
  durationMs: number | null;
  checks: Check[];
  metrics: Record<string, unknown>;
}

export interface RunInfo {
  id: string;
  version: string;
  commit: string | null;
  updatedAt: string | null;
}

export interface Results {
  run: RunInfo;
  levels: LevelResult[];
}

export interface UsageNumbers {
  output: number;
  total: number;
  costUsd: number | null;
}

export interface Usage {
  harness?: string;
  models?: string[];
  measuredAt?: string;
  total: UsageNumbers;
  levels?: Record<string, unknown>;
}

export const STATUS_LABEL: Record<Status, string> = {
  offen: 'Offen',
  bestanden: 'Bestanden',
  fehlgeschlagen: 'Fehlgeschlagen',
  gesperrt: 'Gesperrt',
};

const STATUSES: Status[] = ['offen', 'bestanden', 'fehlgeschlagen', 'gesperrt'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function parseCheck(value: unknown): Check | null {
  if (!isObject(value) || !hasExactKeys(value, ['name', 'ok'])) return null;
  if (!isNonEmptyString(value.name) || typeof value.ok !== 'boolean') return null;
  return { name: value.name, ok: value.ok };
}

function parseLevel(value: unknown): LevelResult | null {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ['level', 'title', 'status', 'checkedAt', 'durationMs', 'checks', 'metrics'])
  ) {
    return null;
  }
  if (!isInteger(value.level) || value.level < 1 || value.level > 10) return null;
  if (typeof value.title !== 'string') return null;
  if (typeof value.status !== 'string' || !STATUSES.includes(value.status as Status)) return null;
  if (!(value.checkedAt === null || isDateString(value.checkedAt))) return null;
  if (!(value.durationMs === null || (isInteger(value.durationMs) && value.durationMs >= 0))) return null;
  if (!Array.isArray(value.checks)) return null;
  const checks: Check[] = [];
  for (const entry of value.checks) {
    const check = parseCheck(entry);
    if (!check) return null;
    checks.push(check);
  }
  if (!isObject(value.metrics)) return null;
  return {
    level: value.level,
    title: value.title,
    status: value.status as Status,
    checkedAt: value.checkedAt,
    durationMs: value.durationMs,
    checks,
    metrics: value.metrics,
  };
}

/** Strenge Prüfung nach results.schema.json. Gibt null zurück, wenn etwas nicht passt. */
export function parseResults(value: unknown): Results | null {
  if (!isObject(value) || !hasExactKeys(value, ['run', 'levels'])) return null;
  const run = value.run;
  if (!isObject(run) || !hasExactKeys(run, ['id', 'version', 'commit', 'updatedAt'])) return null;
  if (!isNonEmptyString(run.id) || !isNonEmptyString(run.version)) return null;
  if (!(run.commit === null || typeof run.commit === 'string')) return null;
  if (!(run.updatedAt === null || isDateString(run.updatedAt))) return null;
  if (!Array.isArray(value.levels) || value.levels.length !== 10) return null;

  const levels: LevelResult[] = [];
  for (const entry of value.levels) {
    const level = parseLevel(entry);
    if (!level) return null;
    levels.push(level);
  }
  const numbers = new Set(levels.map((level) => level.level));
  if (numbers.size !== 10) return null;
  for (let n = 1; n <= 10; n += 1) {
    if (!numbers.has(n)) return null;
  }

  return {
    run: {
      id: run.id,
      version: run.version,
      commit: run.commit,
      updatedAt: run.updatedAt,
    },
    levels: levels.sort((a, b) => a.level - b.level),
  };
}

export function emptyLevel(level: number): LevelResult {
  return {
    level,
    title: LEVEL_TITLES[level - 1],
    status: 'offen',
    checkedAt: null,
    durationMs: null,
    checks: [],
    metrics: {},
  };
}

export function emptyLevels(): LevelResult[] {
  return Array.from({ length: 10 }, (_, index) => emptyLevel(index + 1));
}

export function reachedLevel(levels: LevelResult[]): number {
  let reached = 0;
  for (let n = 1; n <= 10; n += 1) {
    const level = levels.find((entry) => entry.level === n);
    if (level?.status !== 'bestanden') break;
    reached = n;
  }
  return reached;
}

export function formatDateTime(value: string | null): string {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '–';
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(1).replace('.', ',')} s`;
}

export interface BuildInfo {
  buildS?: number;
  inLevel?: number;
}

export function buildInfo(metrics: Record<string, unknown> | undefined): BuildInfo | null {
  if (!metrics) return null;
  const build = metrics.build;
  if (!isObject(build)) return null;
  if (isInteger(build.buildS)) return { buildS: build.buildS };
  if (isInteger(build.inLevel) && build.inLevel >= 1 && build.inLevel <= 10) return { inLevel: build.inLevel };
  return null;
}

export function formatBuild(info: BuildInfo | null): string {
  if (!info) return '–';
  if (info.inLevel !== undefined) return `in L${String(info.inLevel).padStart(2, '0')}`;
  if (info.buildS === undefined) return '–';
  const seconds = Math.max(0, Math.round(info.buildS));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return `${minutes}:${rest} min`;
}

export function checksSummary(checks: Check[]): string {
  if (checks.length === 0) return '–';
  return `${checks.filter((check) => check.ok).length}/${checks.length}`;
}

export function shortCommit(commit: string | null): string {
  return commit ? commit.slice(0, 7) : '–';
}

export function parseUsage(value: unknown): Usage | null {
  if (!isObject(value)) return null;
  const total = value.total;
  if (!isObject(total)) return null;
  if (!isInteger(total.output) || !isInteger(total.total)) return null;
  if (!(total.costUsd === null || typeof total.costUsd === 'number')) return null;
  const usage: Usage = {
    total: { output: total.output, total: total.total, costUsd: total.costUsd },
  };
  if (typeof value.harness === 'string') usage.harness = value.harness;
  if (Array.isArray(value.models)) {
    usage.models = value.models.filter((model): model is string => typeof model === 'string');
  }
  if (typeof value.measuredAt === 'string') usage.measuredAt = value.measuredAt;
  if (isObject(value.levels)) usage.levels = value.levels;
  return usage;
}

export type UsageLevelEntry = { kind: 'inLevel'; inLevel: number } | { kind: 'numbers'; numbers: UsageNumbers };

export function usageLevelEntry(usage: Usage | null, level: number): UsageLevelEntry | null {
  if (!usage?.levels) return null;
  const entry = usage.levels[String(level)];
  if (!isObject(entry)) return null;
  if (isInteger(entry.inLevel) && entry.inLevel >= 1 && entry.inLevel <= 10) {
    return { kind: 'inLevel', inLevel: entry.inLevel };
  }
  if (
    isInteger(entry.output) &&
    isInteger(entry.total) &&
    (entry.costUsd === null || typeof entry.costUsd === 'number')
  ) {
    return {
      kind: 'numbers',
      numbers: { output: entry.output, total: entry.total, costUsd: entry.costUsd },
    };
  }
  return null;
}

export function inLevelLabel(level: number): string {
  return `in L${String(level).padStart(2, '0')}`;
}

export function formatTokens(value: number): string {
  return value.toLocaleString('de-CH');
}

export function formatCost(value: number | null): string {
  if (value === null) return '–';
  return `${value.toFixed(2).replace('.', ',')} USD`;
}

export function formatDecimal(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}

export function formatSeconds(value: number): string {
  return `${Math.round(value)} s`;
}

export function metricNumber(metrics: Record<string, unknown> | undefined, path: string[]): number | null {
  let current: unknown = metrics;
  for (const key of path) {
    if (!isObject(current)) return null;
    current = current[key];
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : null;
}

export function metricObject(
  metrics: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | null {
  if (!metrics) return null;
  const value = metrics[key];
  return isObject(value) ? value : null;
}
