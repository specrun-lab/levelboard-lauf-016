import { formatDateTime, LevelResult, reachedLevel, STATUS_LABEL } from '../results';

interface SummaryProps {
  levels: LevelResult[];
  updatedAt: string | null;
}

export default function Summary({ levels, updatedAt }: SummaryProps) {
  const reached = reachedLevel(levels);
  return (
    <section className="summary" aria-label="Zusammenfassung">
      <div className="summary-value">
        <span className="summary-label">Erreichtes Level</span>
        <div className="summary-number" data-testid="summary-reached">
          {reached} <span className="summary-total">/ 10</span>
        </div>
      </div>
      <div className="summary-right">
        <div
          className="summary-progress"
          role="img"
          aria-label={`${reached} von 10 Levels erreicht`}
          data-testid="summary-progress"
        >
          {levels.map((level) => (
            <span
              key={level.level}
              className={`progress-segment status-${level.status}`}
              title={`Level ${level.level}: ${STATUS_LABEL[level.status]}`}
            />
          ))}
        </div>
        <div className="summary-updated-line">
          Zuletzt aktualisiert:{' '}
          <span data-testid="summary-updated">{formatDateTime(updatedAt)}</span>
        </div>
      </div>
    </section>
  );
}
