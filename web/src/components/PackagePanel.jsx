import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

export default function PackagePanel({ packages, onChange }) {
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Whether a package has been selected/confirmed
  const [confirmedPackage, setConfirmedPackage] = useState(null);

  const [availableVersions, setAvailableVersions] = useState([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [versionNotFound, setVersionNotFound] = useState(false);

  const entries = useMemo(() => Object.entries(packages || {}), [packages]);

  useEffect(() => {
    if (confirmedPackage) {
      setResults([]);
      return undefined;
    }
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.searchPackages(q);
        if (!confirmedPackage) {
          setResults(data.results || []);
        }
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [query, confirmedPackage]);

  // Fetch available versions when a package is confirmed
  useEffect(() => {
    if (!confirmedPackage) {
      setAvailableVersions([]);
      setLoadingVersions(false);
      setVersionNotFound(false);
      return undefined;
    }

    let active = true;
    setLoadingVersions(true);
    setVersionNotFound(false);
    setResults([]);
    setSearching(false);
    setVersion('');

    api.getPackageVersions(confirmedPackage)
      .then((data) => {
        if (!active) return;
        const vers = data.versions || [];
        setAvailableVersions(vers);
        setVersionNotFound(vers.length === 0);
        setVersion((prev) => {
          if (prev) return prev;
          return vers.length > 0 ? `^${vers[0]}` : '*';
        });
      })
      .catch(() => {
        if (!active) return;
        setAvailableVersions([]);
        setVersionNotFound(true);
        setVersion((prev) => prev || '*');
      })
      .finally(() => {
        if (active) setLoadingVersions(false);
      });

    return () => {
      active = false;
    };
  }, [confirmedPackage]);

  function confirmPackageName(pkgName) {
    const trimmed = (pkgName || name).trim().toLowerCase();
    if (!trimmed) return;
    setConfirmedPackage(trimmed);
    setName(trimmed);
    setQuery('');
    setResults([]);
  }

  function resetSelection() {
    setConfirmedPackage(null);
    setName('');
    setVersion('');
    setQuery('');
    setResults([]);
    setAvailableVersions([]);
    setVersionNotFound(false);
  }

  function handleNameKeyDown(e) {
    if (e.key === 'Enter') {
      if (results.length > 0) {
        confirmPackageName(results[0].name);
      } else if (name.trim()) {
        confirmPackageName(name.trim());
      }
    }
  }

  function addPackage(pkgName, pkgVersion = '*') {
    const targetName = (pkgName || confirmedPackage || name).trim();
    if (!targetName) return;
    const next = { ...packages, [targetName]: pkgVersion.trim() || '*' };
    onChange(next);
    resetSelection();
  }

  function removePackage(pkgName) {
    const next = { ...packages };
    delete next[pkgName];
    onChange(next);
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Composer</h2>
        <span className="chip">{entries.length} pkgs</span>
      </div>
      <div className="packages">
        {!confirmedPackage ? (
          <div className="package-form">
            <input
              placeholder="vendor/package を入力または検索"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setQuery(e.target.value);
              }}
              onKeyDown={handleNameKeyDown}
              autoFocus
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => confirmPackageName(name)}
              disabled={!name.trim()}
            >
              確定
            </button>
          </div>
        ) : (
          <div className="package-step-confirmed">
            <div className="package-badge-row">
              <span className="selected-pkg-name">
                📦 <strong>{confirmedPackage}</strong>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={resetSelection}
                title="別のライブラリを選択"
              >
                変更
              </button>
            </div>

            <div className="version-form-row">
              <div className="version-input-wrap">
                <input
                  placeholder="バージョンを入力 (例: ^7.0, 3.2.1, *)"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addPackage(confirmedPackage, version);
                  }}
                  aria-label="バージョン入力"
                  autoFocus
                />
                {availableVersions.length > 0 && (
                  <>
                    <select
                      className="version-select"
                      aria-label="バージョン候補から選択"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          setVersion(e.target.value);
                        }
                      }}
                    >
                      <option value="" disabled>
                        {loadingVersions ? '読み込み中…' : 'バージョンを選択'}
                      </option>
                      <option value="*">* (latest)</option>
                      <optgroup label="Carets (^)">
                        {availableVersions.slice(0, 20).map((v) => (
                          <option key={`caret-${v}`} value={`^${v}`}>
                            ^{v}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Exact">
                        {availableVersions.slice(0, 20).map((v) => (
                          <option key={`exact-${v}`} value={v}>
                            {v}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <span className="version-select-toggle" aria-hidden="true" title="バージョン候補から選択">▾</span>
                  </>
                )}
                {loadingVersions && (
                  <span className="version-loading-hint">読込中…</span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => addPackage(confirmedPackage, version)}
              >
                追加
              </button>
            </div>

            {loadingVersions && <p className="hints">バージョン一覧を取得中…</p>}
            {versionNotFound && !loadingVersions && (
              <p className="hints">バージョン候補の取得に失敗しました。手動で入力できます。</p>
            )}
            {availableVersions.length > 0 && (
              <p className="hints">
                バージョンは直接入力するか、右端の ▾ メニューから選択できます
              </p>
            )}
          </div>
        )}

        {searching && <p className="hints">Packagist を検索中…</p>}
        {!confirmedPackage && results.length > 0 && (
          <ul className="search-results">
            {results.map((item) => (
              <li key={item.name}>
                <button type="button" onClick={() => confirmPackageName(item.name)}>
                  <strong>{item.name}</strong>
                  {item.description && <span className="desc">{item.description}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <ul className="package-list">
          {entries.length === 0 && (
            <li className="hints">例: <code>guzzlehttp/guzzle</code> を <code>^7.0</code> で追加</li>
          )}
          {entries.map(([pkg, ver]) => (
            <li className="package-item" key={pkg}>
              <div>
                <code>{pkg}</code>{' '}
                <code className="ver">{ver}</code>
              </div>
              <button type="button" className="icon-btn" onClick={() => removePackage(pkg)} aria-label="remove">
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
