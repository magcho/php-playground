async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

export const api = {
  ensureSession: () => request('/api/session', { method: 'POST' }),
  getVersions: () => request('/api/versions'),
  run: (payload) =>
    request('/api/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  searchPackages: (q) =>
    request(`/api/packagist/search?q=${encodeURIComponent(q)}`),
};
