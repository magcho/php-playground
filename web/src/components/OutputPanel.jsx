export default function OutputPanel({ result, running, error }) {
  const execution = result?.execution;
  const composer = result?.composer;

  let body = null;
  if (running) {
    body = <span className="empty">実行中… Docker コンテナで PHP を起動しています</span>;
  } else if (error) {
    body = <span className="stderr">{error}</span>;
  } else if (!result) {
    body = <span className="empty">Run を押すと stdout / stderr がここに出ます</span>;
  } else if (result.phase === 'composer' && composer && !composer.ok) {
    body = (
      <>
        <div className="stderr">Composer 失敗</div>
        {composer.stderr && <div className="stderr">{composer.stderr}</div>}
        {composer.stdout && <div className="stdout">{composer.stdout}</div>}
      </>
    );
  } else {
    body = (
      <>
        {execution?.stdout && <div className="stdout">{execution.stdout}</div>}
        {execution?.stderr && <div className="stderr">{execution.stderr}</div>}
        {!execution?.stdout && !execution?.stderr && (
          <span className="empty">（出力なし）exit {execution?.exitCode ?? '?'}</span>
        )}
      </>
    );
  }

  return (
    <section className="panel output">
      <div className="panel-header">
        <h2 className="panel-title">Output</h2>
      </div>
      {result && (
        <div className="output-meta">
          <span className={`chip ${result.ok ? 'ok' : 'err'}`}>
            {result.ok ? 'success' : 'failed'}
          </span>
          <span className="chip">PHP {result.phpVersion}</span>
          {execution && (
            <span className="chip">{execution.durationMs} ms</span>
          )}
          {composer && !composer.skipped && (
            <span className="chip">composer {composer.durationMs} ms</span>
          )}
          {execution?.timedOut && <span className="chip err">timeout</span>}
        </div>
      )}
      <pre className="output-body">{body}</pre>
    </section>
  );
}
