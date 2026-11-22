import { useEffect, useState } from 'react';
import Header from './components/Header';
import LevelCard from './components/LevelCard';
import Notice from './components/Notice';
import Report from './components/Report';
import Summary from './components/Summary';
import {
  emptyLevels,
  LoadState,
  parseResults,
  parseUsage,
  Results,
  Source,
  Usage,
} from './results';

function isHtmlResponse(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

export default function App() {
  const [source, setSource] = useState<Source>('loading');
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<Results | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const loadFile = async () => {
      let response: Response;
      try {
        setState('loading');
        response = await fetch('/results.json', { cache: 'no-store', signal: controller.signal });
      } catch {
        if (disposed) return;
        setData(null);
        setState('missing');
        return;
      }
      if (disposed) return;
      if (response.status === 404) {
        setData(null);
        setState('missing');
        return;
      }
      if (response.ok && isHtmlResponse(response)) {
        setData(null);
        setState('missing');
        return;
      }
      if (!response.ok) {
        setData(null);
        setState('invalid');
        return;
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        if (disposed) return;
        setData(null);
        setState('invalid');
        return;
      }
      if (disposed) return;
      const parsed = parseResults(value);
      if (!parsed) {
        setData(null);
        setState('invalid');
        return;
      }
      setData(parsed);
      setState('ok');
    };

    const poll = async () => {
      let response: Response;
      try {
        response = await fetch('/api/levels', { cache: 'no-store', signal: controller.signal });
      } catch {
        if (!disposed) {
          setData(null);
          setUsage(null);
          setState('unavailable');
        }
        if (!disposed) timer = setTimeout(poll, 5000);
        return;
      }
      if (disposed) return;
      if (!response.ok || isHtmlResponse(response)) {
        setData(null);
        setUsage(null);
        setState('unavailable');
      } else {
        let value: unknown;
        try {
          value = await response.json();
        } catch {
          value = undefined;
        }
        if (disposed) return;
        const parsed = parseResults(value);
        if (!parsed) {
          setData(null);
          setUsage(null);
          setState('invalid');
        } else {
          let parsedUsage: Usage | null = null;
          try {
            const usageResponse = await fetch('/api/usage', {
              cache: 'no-store',
              signal: controller.signal,
            });
            if (usageResponse.ok && !isHtmlResponse(usageResponse)) {
              parsedUsage = parseUsage(await usageResponse.json());
            }
          } catch {
            parsedUsage = null;
          }
          if (disposed) return;
          setData(parsed);
          setUsage(parsedUsage);
          setState('ok');
        }
      }
      if (!disposed) {
        timer = setTimeout(poll, 5000);
      }
    };

    const start = async () => {
      let mode: 'file' | 'api' = 'file';
      try {
        const response = await fetch('/config.json', { cache: 'no-store', signal: controller.signal });
        if (response.ok && !isHtmlResponse(response)) {
          const config: unknown = await response.json();
          if (
            typeof config === 'object' &&
            config !== null &&
            (config as Record<string, unknown>).source === 'api'
          ) {
            mode = 'api';
          }
        }
      } catch {
        mode = 'file';
      }
      if (disposed) return;
      setSource(mode);
      if (mode === 'api') {
        await poll();
      } else {
        await loadFile();
      }
    };

    start();

    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const levels = state === 'ok' && data ? data.levels : emptyLevels();
  const run = state === 'ok' && data ? data.run : null;
  const boardState: LoadState = source === 'loading' ? 'loading' : state;

  return (
    <div className="app" data-testid="board" data-state={boardState}>
      <Header
        runId={run?.id ?? '–'}
        version={run?.version ?? '–'}
        commit={run?.commit ?? null}
        source={source}
      />
      <main className="main">
        {state === 'missing' || state === 'invalid' || state === 'unavailable' ? (
          <Notice kind={state} />
        ) : null}
        <Summary levels={levels} updatedAt={run?.updatedAt ?? null} />
        <section className="level-grid" aria-label="Levels">
          {levels.map((level) => (
            <LevelCard level={level} key={level.level} />
          ))}
        </section>
        <Report
          levels={levels}
          run={
            run ?? {
              id: '–',
              version: '–',
              commit: null,
              updatedAt: null,
            }
          }
          usage={usage}
        />
      </main>
    </div>
  );
}
