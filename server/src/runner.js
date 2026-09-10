import express from 'express';
import { config } from './config.js';
import { DockerRunner } from './services/docker-runner.js';
import { createRunnerRouter } from './routes/runner-api.js';

async function main() {
  if (!config.runnerToken) {
    console.error('[phbox-runner] RUNNER_TOKEN is required');
    process.exit(1);
  }

  const dockerRunner = new DockerRunner();

  dockerRunner.ensureImages().then((results) => {
    const failed = results.filter((r) => !r.ready);
    if (failed.length) {
      console.warn('[phbox-runner] some images failed to pull:', failed);
    } else {
      console.log(
        '[phbox-runner] images ready:',
        results.map((r) => r.image).join(', '),
      );
    }
  }).catch((err) => {
    console.warn('[phbox-runner] image ensure failed:', err.message);
  });

  dockerRunner.checkPhpRuntime().then((runtime) => {
    if (!runtime.ok) {
      console.warn('[phbox-runner] PHP runtime not ready:', runtime.error);
    } else {
      console.log(`[phbox-runner] PHP runtime ready: ${runtime.php}`);
    }
  }).catch((err) => {
    console.warn('[phbox-runner] runtime check failed:', err.message);
  });

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '300kb' }));
  app.use(createRunnerRouter({ dockerRunner }));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  const port = Number(process.env.PORT || 8081);
  app.listen(port, '0.0.0.0', () => {
    console.log(`[phbox-runner] listening on :${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
