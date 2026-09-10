import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { runCommand } from '../services/process.js';

const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireRunnerToken(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!config.runnerToken || !token || token !== config.runnerToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

export function createRunnerRouter({ dockerRunner }) {
  const router = Router();
  router.use(requireRunnerToken);

  router.get('/health', async (_req, res) => {
    const docker = await runCommand(
      dockerRunner.dockerBin,
      ['version', '--format', '{{.Server.Version}}'],
      { timeoutMs: 5_000 },
    );
    const runtime = await dockerRunner.checkPhpRuntime();
    const ok = docker.ok && runtime.ok;
    res.status(ok ? 200 : 503).json({
      ok,
      service: 'phbox-runner',
      docker: {
        ok: docker.ok,
        version: docker.ok ? docker.stdout.trim() : null,
        error: docker.ok ? null : docker.stderr || docker.stdout,
      },
      runtime,
    });
  });

  router.post('/v1/run', async (req, res) => {
    const sessionId = String(req.body?.sessionId || '');
    if (!SESSION_ID_RE.test(sessionId)) {
      return res.status(400).json({ error: 'invalid sessionId' });
    }

    const phpVersion = String(req.body?.phpVersion || '');
    if (!config.phpVersions[phpVersion]) {
      return res.status(400).json({ error: 'unsupported phpVersion' });
    }

    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (Buffer.byteLength(code, 'utf8') > config.maxCodeBytes) {
      return res.status(400).json({ error: `code exceeds ${config.maxCodeBytes} bytes` });
    }

    const packages =
      req.body?.packages && typeof req.body.packages === 'object' && !Array.isArray(req.body.packages)
        ? req.body.packages
        : {};
    if (Object.keys(packages).length > config.maxPackages) {
      return res.status(400).json({ error: `too many packages (max ${config.maxPackages})` });
    }

    const sessionDir = path.join(config.dataDir, 'sessions', sessionId);
    const session = { phpVersion, code, packages };

    try {
      const result = await dockerRunner.run(sessionDir, session);
      res.json({
        ok: result.ok,
        phase: result.phase,
        phpVersion: result.phpVersion,
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
    } catch (err) {
      console.error('[phbox-runner] run failed:', err);
      res.status(500).json({ error: err.message || 'run failed' });
    }
  });

  return router;
}
