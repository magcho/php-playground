import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { SessionStore } from './services/session.js';
import { DockerRunner } from './services/docker-runner.js';
import { createApiRouter } from './routes/api.js';
import { apiLimiter } from './middleware/rate-limit.js';

async function main() {
  const sessions = new SessionStore();
  await sessions.init();

  const runner = new DockerRunner();

  // Pull images in background so first run is faster
  runner.ensureImages().then((results) => {
    const failed = results.filter((r) => !r.ready);
    if (failed.length) {
      console.warn('[phbox] some images failed to pull:', failed);
    } else {
      console.log('[phbox] runner images ready:', results.map((r) => r.image).join(', '));
    }
  }).catch((err) => {
    console.warn('[phbox] image ensure failed:', err.message);
  });

  setInterval(() => {
    sessions.cleanupExpired().then((n) => {
      if (n > 0) console.log(`[phbox] cleaned ${n} expired session(s)`);
    }).catch(() => {});
  }, 60 * 60 * 1000).unref();

  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '300kb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter, createApiRouter({ sessions, runner }));

  const staticDir = config.staticDir;
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.type('html').send(`<!doctype html><meta charset="utf-8"><title>PHBox</title>
        <body style="font-family:sans-serif;padding:2rem">
        <h1>PHBox API is running</h1>
        <p>Frontend build not found at <code>${staticDir}</code>.</p>
        </body>`);
    });
  }

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[phbox] listening on :${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
