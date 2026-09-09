import { useCallback, useEffect, useState } from 'react';
import Editor from './components/Editor.jsx';
import PackagePanel from './components/PackagePanel.jsx';
import OutputPanel from './components/OutputPanel.jsx';
import { api } from './api.js';

const DEFAULT_CODE = `<?php

declare(strict_types=1);

echo "Hello from PHBox\\n";
echo "PHP " . PHP_VERSION . "\\n";
`;

export default function App() {
  const [ready, setReady] = useState(false);
  const [versions, setVersions] = useState(['8.1', '8.2', '8.3', '8.4']);
  const [phpVersion, setPhpVersion] = useState('8.3');
  const [code, setCode] = useState(DEFAULT_CODE);
  const [packages, setPackages] = useState({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sessionRes, versionsRes] = await Promise.all([
          api.ensureSession(),
          api.getVersions(),
        ]);
        if (cancelled) return;
        if (versionsRes.versions?.length) setVersions(versionsRes.versions);
        const session = sessionRes.session;
        if (session) {
          setCode(session.code || DEFAULT_CODE);
          setPhpVersion(session.phpVersion || versionsRes.default || '8.3');
          setPackages(session.packages || {});
        }
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || '初期化に失敗しました');
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const data = await api.run({
        code,
        phpVersion,
        packages,
      });
      setResult(data);
    } catch (err) {
      setError(err.message || '実行に失敗しました');
    } finally {
      setRunning(false);
    }
  }, [code, phpVersion, packages]);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!running) run();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, running]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">PHBox</div>
          <div className="brand-tag">ログイン不要の PHP サンドボックス</div>
        </div>
        <div className="top-actions">
          <div className="field">
            <label htmlFor="php-version">PHP</label>
            <select
              id="php-version"
              value={phpVersion}
              onChange={(e) => setPhpVersion(e.target.value)}
              disabled={!ready || running}
            >
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={run}
            disabled={!ready || running}
          >
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">index.php</h2>
            <span className="chip">Ctrl/⌘ + Enter</span>
          </div>
          <Editor value={code} onChange={setCode} />
        </section>

        <div className="side-stack">
          <PackagePanel packages={packages} onChange={setPackages} />
          <OutputPanel result={result} running={running} error={error} />
        </div>
      </main>

      <footer className="status-bar">
        <span>匿名セッション · Composer 任意バージョン · Docker 隔離実行</span>
        <span>
          実行: <span className="kbd">Ctrl</span> + <span className="kbd">Enter</span>
        </span>
      </footer>
    </div>
  );
}
