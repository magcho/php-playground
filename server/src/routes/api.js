import { Router } from 'express';
import { config } from '../config.js';
import { runLimiter } from '../middleware/rate-limit.js';

export function createApiRouter({ sessions, runner }) {
  const router = Router();

  async function requireSession(req, res) {
    const id = req.cookies?.[config.cookieName];
    if (!id || !(await sessions.exists(id))) {
      res.status(401).json({ error: 'session required' });
      return null;
    }
    return id;
  }

  function setSessionCookie(res, id) {
    res.cookie(config.cookieName, id, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: config.sessionTtlMs,
      path: '/',
    });
  }

  router.get('/health', async (_req, res) => {
    const runnerHealth = await runner.health();
    const runtimeOk = runnerHealth.runtime?.ok ?? false;
    res.status(runnerHealth.ok ? 200 : 503).json({
      ok: runnerHealth.ok,
      service: 'phbox',
      versions: Object.keys(config.phpVersions),
      runner: {
        ok: Boolean(runnerHealth.docker?.ok ?? runnerHealth.ok),
        phpRuntime: runnerHealth.runtime?.php || config.phpRuntime,
        runtimeOk,
        error: runnerHealth.ok
          ? null
          : runnerHealth.runtime?.error || runnerHealth.docker?.error || runnerHealth.error || null,
      },
    });
  });

  router.get('/versions', (_req, res) => {
    res.json({
      versions: Object.keys(config.phpVersions),
      default: '8.3',
    });
  });

  router.post('/session', async (req, res) => {
    const existing = req.cookies?.[config.cookieName];
    if (existing && (await sessions.exists(existing))) {
      const session = await sessions.get(existing);
      setSessionCookie(res, existing);
      return res.json({ session, created: false });
    }
    const session = await sessions.create();
    setSessionCookie(res, session.id);
    res.status(201).json({ session, created: true });
  });

  router.get('/session', async (req, res) => {
    const id = await requireSession(req, res);
    if (!id) return;
    const session = await sessions.get(id);
    res.json({ session });
  });

  router.put('/session/code', async (req, res) => {
    const id = await requireSession(req, res);
    if (!id) return;
    try {
      await sessions.setCode(id, req.body?.code ?? '');
      const session = await sessions.get(id);
      res.json({ session });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/session/php-version', async (req, res) => {
    const id = await requireSession(req, res);
    if (!id) return;
    try {
      await sessions.setPhpVersion(id, String(req.body?.phpVersion || ''));
      const session = await sessions.get(id);
      res.json({ session });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/session/packages', async (req, res) => {
    const id = await requireSession(req, res);
    if (!id) return;
    try {
      await sessions.setPackages(id, req.body?.packages || {});
      const session = await sessions.get(id);
      res.json({ session });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/run', runLimiter, async (req, res) => {
    let id = req.cookies?.[config.cookieName];
    if (!id || !(await sessions.exists(id))) {
      const created = await sessions.create();
      id = created.id;
      setSessionCookie(res, id);
    }

    try {
      if (typeof req.body?.code === 'string') {
        await sessions.setCode(id, req.body.code);
      }
      if (req.body?.phpVersion) {
        await sessions.setPhpVersion(id, String(req.body.phpVersion));
      }
      if (req.body?.packages && typeof req.body.packages === 'object') {
        await sessions.setPackages(id, req.body.packages);
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const session = await sessions.get(id);

    let result;
    try {
      result = await runner.run({
        sessionId: id,
        phpVersion: session.phpVersion,
        code: session.code,
        packages: session.packages,
      });
    } catch (err) {
      if (err.code === 'RUNNER_UNAVAILABLE') {
        return res.status(502).json({ error: 'runner unavailable' });
      }
      if (err.code === 'RUNNER_BAD_REQUEST') {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    await sessions.markRun(id);

    res.json({
      ok: result.ok,
      phase: result.phase,
      phpVersion: result.phpVersion,
      packages: session.packages,
      composer: result.composer
        ? {
            skipped: result.composer.skipped,
            ok: result.composer.ok,
            exitCode: result.composer.exitCode,
            timedOut: result.composer.timedOut,
            durationMs: result.composer.durationMs,
            stdout: result.composer.stdout,
            stderr: result.composer.stderr,
          }
        : null,
      execution: result.execution
        ? {
            ok: result.execution.ok,
            exitCode: result.execution.exitCode,
            timedOut: result.execution.timedOut,
            durationMs: result.execution.durationMs,
            stdout: result.execution.stdout,
            stderr: result.execution.stderr,
          }
        : null,
    });
  });

  router.get('/packagist/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ results: [] });
    }
    try {
      const url = `https://packagist.org/search.json?q=${encodeURIComponent(q)}&per_page=8`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        return res.status(502).json({ error: 'packagist unavailable' });
      }
      const data = await response.json();
      const results = (data.results || []).map((item) => ({
        name: item.name,
        description: item.description,
        url: item.url,
        repository: item.repository,
        downloads: item.downloads,
      }));
      res.json({ results });
    } catch (err) {
      res.status(502).json({ error: err.message || 'packagist search failed' });
    }
  });

  router.get('/packagist/versions', async (req, res) => {
    const pkg = String(req.query.package || '').trim().toLowerCase();
    if (!pkg || !/^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9]([_.-]?[a-z0-9]+)*$/.test(pkg)) {
      return res.status(400).json({ error: 'invalid package name' });
    }
    try {
      const url = `https://repo.packagist.org/p2/${pkg}.json`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 404) {
        return res.status(404).json({ error: 'package not found', versions: [] });
      }
      if (!response.ok) {
        return res.status(502).json({ error: 'failed to fetch package metadata' });
      }
      const data = await response.json();
      const packageEntries = data.packages?.[pkg] || [];
      const versions = packageEntries
        .map((entry) => entry.version)
        .filter((v) => typeof v === 'string' && !v.startsWith('dev-') && !v.endsWith('-dev'));

      res.json({ package: pkg, versions: versions.slice(0, 50) });
    } catch (err) {
      res.status(502).json({ error: err.message || 'failed to fetch package versions' });
    }
  });

  return router;
}
