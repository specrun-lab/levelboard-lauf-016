import {
  buildInfo,
  formatBuild,
  formatCost,
  formatDateTime,
  formatDecimal,
  formatSeconds,
  formatTokens,
  inLevelLabel,
  LEVEL_TITLES,
  LevelResult,
  metricNumber,
  metricObject,
  reachedLevel,
  RunInfo,
  STATUS_LABEL,
  Usage,
  usageLevelEntry,
} from '../results';

interface ReportProps {
  levels: LevelResult[];
  run: RunInfo;
  usage: Usage | null;
}

function valueOrDash(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '–' : value;
}

function TokenValue({ value }: { value: number | null }) {
  return <>{value === null ? '–' : formatTokens(value)}</>;
}

export default function Report({ levels, run, usage }: ReportProps) {
  const checked = levels.some((level) => level.checkedAt !== null);
  const reached = reachedLevel(levels);
  const complete = levels.find((level) => level.level === 10)?.status === 'bestanden';

  if (!checked) {
    return (
      <section
        className="report"
        aria-label="Abschlussbericht"
        data-testid="report"
        data-state="empty"
        data-complete={complete ? 'true' : 'false'}
      >
        <h2 className="report-heading">Abschlussbericht</h2>
        <p className="report-empty" data-testid="report-empty">
          Noch kein Abschlussbericht – er erscheint, sobald das erste Level geprüft ist.
        </p>
      </section>
    );
  }

  const buildTotal = levels.reduce((sum, level) => {
    const info = buildInfo(level.metrics);
    return info && info.buildS !== undefined ? sum + info.buildS : sum;
  }, 0);
  const hasBuild = levels.some((level) => buildInfo(level.metrics)?.buildS !== undefined);

  const loadtest = metricObject(levels.find((level) => level.level === 9)?.metrics, 'loadtest');
  const p50 = loadtest ? (loadtest.p50Ms as number | undefined) : undefined;
  const p95 = loadtest ? (loadtest.p95Ms as number | undefined) : undefined;
  const rps = loadtest ? (loadtest.rps as number | undefined) : undefined;
  const errors = loadtest ? (loadtest.errors as number | undefined) : undefined;

  const images = metricObject(levels.find((level) => level.level === 7)?.metrics, 'images');
  const frontendMB = images ? (images.frontendMB as number | undefined) : undefined;
  const backendMB = images ? (images.backendMB as number | undefined) : undefined;

  const pipeline = metricObject(levels.find((level) => level.level === 6)?.metrics, 'pipeline');
  const jobs = pipeline && typeof pipeline.jobs === 'object' && pipeline.jobs !== null
    ? (pipeline.jobs as Record<string, unknown>)
    : null;
  const pipelineUrl = pipeline && typeof pipeline.url === 'string' ? pipeline.url : null;

  const totalS = pipeline ? metricNumber(pipeline, ['totalS']) : null;
  const jobSeconds = (name: string): number | null => {
    if (!jobs) return null;
    const value = jobs[name];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  const tokenNumbers = usage?.total;
  const modelsText = usage?.models && usage.models.length > 0 ? usage.models.join(', ') : '–';

  return (
    <section
      className="report"
      aria-label="Abschlussbericht"
      data-testid="report"
      data-state="ready"
      data-complete={complete ? 'true' : 'false'}
    >
      <h2 className="report-heading">Abschlussbericht</h2>
      <div className="report-tiles">
        <section className="report-tile">
          <h3>Ergebnis</h3>
          <dl>
            <div>
              <dt>Erreicht</dt>
              <dd data-testid="report-reached">{reached} / 10</dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd data-testid="report-score">{reached * 10} / 100</dd>
            </div>
            <div>
              <dt>Vollständig</dt>
              <dd data-testid="report-complete">{complete ? 'ja' : 'nein'}</dd>
            </div>
            <div>
              <dt>Bauzeit gesamt</dt>
              <dd data-testid="report-build-time">
                {hasBuild ? formatBuild({ buildS: buildTotal }) : '–'}
              </dd>
            </div>
            <div>
              <dt>Commit</dt>
              <dd data-testid="report-commit">{run.commit ? run.commit.slice(0, 7) : '–'}</dd>
            </div>
            <div>
              <dt>Stand</dt>
              <dd data-testid="report-time">{formatDateTime(run.updatedAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="report-tile">
          <h3>Tokens</h3>
          {tokenNumbers ? (
            <dl>
              <div>
                <dt>Harness</dt>
                <dd data-testid="report-harness">{valueOrDash(usage?.harness)}</dd>
              </div>
              <div>
                <dt>Modell</dt>
                <dd data-testid="report-model">{modelsText}</dd>
              </div>
              <div>
                <dt>Tokens (Ausgabe)</dt>
                <dd data-testid="report-tokens-output">
                  <TokenValue value={tokenNumbers.output} />
                </dd>
              </div>
              <div>
                <dt>Tokens gesamt</dt>
                <dd data-testid="report-tokens-total">
                  <TokenValue value={tokenNumbers.total} />
                </dd>
              </div>
              <div>
                <dt>Kosten gesamt</dt>
                <dd data-testid="report-cost">{formatCost(tokenNumbers.costUsd)}</dd>
              </div>
            </dl>
          ) : (
            <p className="report-missing" data-testid="report-tokens-missing">
              wird nach der Prüfung ergänzt
            </p>
          )}
        </section>

        <section className="report-tile">
          <h3>Lasttest</h3>
          {loadtest ? (
            <dl>
              <div>
                <dt>p50</dt>
                <dd data-testid="report-p50">{typeof p50 === 'number' ? `${Math.round(p50)} ms` : '–'}</dd>
              </div>
              <div>
                <dt>p95</dt>
                <dd data-testid="report-p95">{typeof p95 === 'number' ? `${Math.round(p95)} ms` : '–'}</dd>
              </div>
              <div>
                <dt>Durchsatz</dt>
                <dd data-testid="report-rps">
                  {typeof rps === 'number' ? `${formatDecimal(rps)} Anfragen/s` : '–'}
                </dd>
              </div>
              <div>
                <dt>Fehler</dt>
                <dd data-testid="report-errors">{typeof errors === 'number' ? errors : '–'}</dd>
              </div>
            </dl>
          ) : (
            <p className="report-missing" data-testid="report-loadtest-missing">
              noch nicht erreicht
            </p>
          )}
        </section>

        <section className="report-tile">
          <h3>Images</h3>
          {images ? (
            <dl>
              <div>
                <dt>Frontend</dt>
                <dd data-testid="report-image-frontend">
                  {typeof frontendMB === 'number' ? `${formatDecimal(frontendMB)} MB` : '–'}
                </dd>
              </div>
              <div>
                <dt>Backend</dt>
                <dd data-testid="report-image-backend">
                  {typeof backendMB === 'number' ? `${formatDecimal(backendMB)} MB` : '–'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="report-missing" data-testid="report-images-missing">
              noch nicht erreicht
            </p>
          )}
        </section>

        <section className="report-tile">
          <h3>Pipeline</h3>
          {pipeline ? (
            <>
              <dl>
                <div>
                  <dt>check</dt>
                  <dd data-testid="report-job-check">
                    {jobSeconds('check') === null ? '–' : formatSeconds(jobSeconds('check')!)}
                  </dd>
                </div>
                <div>
                  <dt>images</dt>
                  <dd data-testid="report-job-images">
                    {jobSeconds('images') === null ? '–' : formatSeconds(jobSeconds('images')!)}
                  </dd>
                </div>
                <div>
                  <dt>deploy</dt>
                  <dd data-testid="report-job-deploy">
                    {jobSeconds('deploy') === null ? '–' : formatSeconds(jobSeconds('deploy')!)}
                  </dd>
                </div>
                <div>
                  <dt>Gesamt</dt>
                  <dd data-testid="report-pipeline-total">
                    {totalS === null ? '–' : formatSeconds(totalS)}
                  </dd>
                </div>
              </dl>
              {pipelineUrl ? (
                <a
                  className="report-pipeline-link"
                  data-testid="report-pipeline-link"
                  href={pipelineUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Lauf ansehen
                </a>
              ) : null}
            </>
          ) : (
            <p className="report-missing" data-testid="report-pipeline-missing">
              noch nicht erreicht
            </p>
          )}
        </section>
      </div>

      <div className="report-list">
        <div className="report-list-head" aria-hidden="true">
          <span>Level</span>
          <span>Status</span>
          <span>Kosten</span>
          <span>Tokens (Ausgabe)</span>
          <span>Geprüft</span>
        </div>
        <ol className="report-levels" data-testid="report-levels">
          {levels.map((level) => {
            const entry = usageLevelEntry(usage, level.level);
            let cost = '–';
            let output = '–';
            if (entry?.kind === 'inLevel') {
              cost = inLevelLabel(entry.inLevel);
              output = inLevelLabel(entry.inLevel);
            } else if (entry?.kind === 'numbers') {
              cost = formatCost(entry.numbers.costUsd);
              output = formatTokens(entry.numbers.output);
            }
            return (
              <li
                className="report-level"
                data-testid="report-level"
                data-level={level.level}
                data-status={level.status}
                key={level.level}
              >
                <span className="report-level-name">
                  L{String(level.level).padStart(2, '0')} {LEVEL_TITLES[level.level - 1]}
                </span>
                <span className={`report-level-status status-${level.status}`}>
                  <span className="report-level-dot" aria-hidden="true" />
                  {STATUS_LABEL[level.status]}
                </span>
                <span className="report-level-cost" data-testid="report-level-cost">
                  {cost}
                </span>
                <span className="report-level-output" data-testid="report-level-output">
                  {output}
                </span>
                <span className="report-level-time">{formatDateTime(level.checkedAt)}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
