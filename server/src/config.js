import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '../../data');

export const config = {
  port: Number(process.env.PORT || 8080),
  dataDir,
  // Path as seen by the Docker daemon (host path when using mounted docker.sock)
  hostDataDir: process.env.HOST_DATA_DIR || dataDir,
  staticDir: process.env.STATIC_DIR || path.resolve(__dirname, '../../web/dist'),
  sessionTtlMs: Number(process.env.SESSION_TTL_MS || 24 * 60 * 60 * 1000),
  cookieName: 'phbox_sid',
  runTimeoutMs: Number(process.env.RUN_TIMEOUT_MS || 15000),
  composerTimeoutMs: Number(process.env.COMPOSER_TIMEOUT_MS || 120000),
  maxCodeBytes: Number(process.env.MAX_CODE_BYTES || 200_000),
  maxPackages: Number(process.env.MAX_PACKAGES || 20),
  memoryLimit: process.env.RUNNER_MEMORY || '256m',
  composerMemory: process.env.COMPOSER_MEMORY || '512m',
  cpus: process.env.RUNNER_CPUS || '0.5',
  phpIniPath: process.env.PHP_INI_PATH || path.resolve(__dirname, '../../runners/php.ini'),
  phpVersions: {
    '8.1': process.env.PHP_IMAGE_81 || 'php:8.1-cli',
    '8.2': process.env.PHP_IMAGE_82 || 'php:8.2-cli',
    '8.3': process.env.PHP_IMAGE_83 || 'php:8.3-cli',
    '8.4': process.env.PHP_IMAGE_84 || 'php:8.4-cli',
  },
  composerImage: process.env.COMPOSER_IMAGE || 'composer:2',
  /** PHP sandbox Docker runtime (gVisor). Never silently fall back to runc. */
  phpRuntime: process.env.PHP_RUNTIME || 'runsc',
  runnerUrl: process.env.RUNNER_URL || 'http://runner:8081',
  runnerToken: process.env.RUNNER_TOKEN || '',
  /** Global in-process concurrency for PHP/Composer runs on the runner. */
  maxConcurrentRuns: Number(process.env.MAX_CONCURRENT_RUNS || 4),
  maxQueuedRuns: Number(process.env.MAX_QUEUED_RUNS || 16),
  /** Soft disk budget per session directory (bytes). */
  maxSessionDiskBytes: Number(process.env.MAX_SESSION_DISK_BYTES || 200 * 1024 * 1024),
  defaultCode: `<?php

declare(strict_types=1);

echo "Hello from PHBox\\n";
echo "PHP " . PHP_VERSION . "\\n";
`,
};
