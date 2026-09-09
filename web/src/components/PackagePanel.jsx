import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

export default function PackagePanel({ packages, onChange }) {
  const [name, setName] = useState('');
  const [version, setVersion] = useState('^');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const entries = useMemo(() => Object.entries(packages || {}), [packages]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.searchPackages(q);
        setResults(data.results || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [query]);

  function addPackage(pkgName, pkgVersion = '*') {
    if (!pkgName.trim()) return;
    const next = { ...packages, [pkgName.trim()]: pkgVersion || '*' };
    onChange(next);
    setName('');
    setVersion('^');
    setQuery('');
    setResults([]);
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
        <div className="package-form">
          <input
            placeholder="vendor/package"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addPackage(name, version);
            }}
          />
          <input
            placeholder="^7.0 / * / 3.2.1"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addPackage(name, version);
            }}
          />
          <button type="button" className="btn btn-ghost" onClick={() => addPackage(name, version)}>
            追加
          </button>
        </div>

        {searching && <p className="hints">Packagist を検索中…</p>}
        {results.length > 0 && (
          <ul className="search-results">
            {results.map((item) => (
              <li key={item.name}>
                <button type="button" onClick={() => addPackage(item.name, '*')}>
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
