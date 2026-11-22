import { Source, shortCommit } from '../results';

interface HeaderProps {
  runId: string;
  version: string;
  commit: string | null;
  source: Source;
}

export default function Header({ runId, version, commit, source }: HeaderProps) {
  const sourceText = source === 'file' ? 'Datei' : source === 'api' ? 'Backend' : '–';
  const sourceAttr = source === 'file' ? 'file' : source === 'api' ? 'api' : '';
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          ▮▮▮
        </span>
        <span className="brand-name">Levelboard</span>
      </div>
      <dl className="run-meta">
        <div className="run-meta-pair">
          <dt>Durchlauf</dt>
          <dd data-testid="run-id">{runId}</dd>
        </div>
        <div className="run-meta-pair">
          <dt>Version</dt>
          <dd data-testid="run-version">{version}</dd>
        </div>
        <div className="run-meta-pair">
          <dt>Commit</dt>
          <dd data-testid="run-commit" title={commit ?? undefined}>
            {shortCommit(commit)}
          </dd>
        </div>
        <div className="run-meta-pair">
          <dt>Quelle</dt>
          <dd data-testid="run-source" data-source={sourceAttr}>
            {sourceText}
          </dd>
        </div>
      </dl>
    </header>
  );
}
