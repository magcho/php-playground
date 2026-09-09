import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { runCommand } from './process.js';

function dockerBaseArgs(memory, network) {
  return [
    'run',
    '--rm',
    '--network',
    network,
    '--memory',
    memory,
    '--cpus',
    config.cpus,
    '--pids-limit',
    '128',
    '--security-opt',
    'no-new-privileges',
  ];
}

export class DockerRunner {
  constructor(options = {}) {
    this.dockerBin = options.dockerBin || process.env.DOCKER_BIN || 'docker';
  }

  async ensureImages() {
    const images = [
      ...Object.values(config.phpVersions),
      config.composerImage,
    ];
    const unique = [...new Set(images)];
    const results = [];
    for (const image of unique) {
      const inspect = await runCommand(this.dockerBin, ['image', 'inspect', image], {
        timeoutMs: 10_000,
      });
      if (inspect.ok) {
        results.push({ image, ready: true, pulled: false });
        continue;
      }
      const pull = await runCommand(this.dockerBin, ['pull', image], {
        timeoutMs: 300_000,
      });
      results.push({
        image,
        ready: pull.ok,
        pulled: true,
        error: pull.ok ? null : pull.stderr || pull.stdout,
      });
    }
    return results;
  }

  hostPathFor(containerPath) {
    const rel = path.relative(config.dataDir, containerPath);
    if (rel.startsWith('..')) {
      throw new Error('workspace path escapes data dir');
    }
    return path.join(config.hostDataDir, rel);
  }

  async prepareWorkspace(sessionDir, session) {
    const runId = randomUUID();
    const workDir = path.join(sessionDir, 'runs', runId);
    await fs.mkdir(workDir, { recursive: true });
    await fs.chmod(workDir, 0o755);

    const code = session.code?.startsWith('<?')
      ? session.code
      : `<?php\n${session.code || ''}`;
    await fs.writeFile(path.join(workDir, 'index.php'), code);

    const composerJson = {
      name: 'phbox/sandbox',
      description: 'Ephemeral PHBox sandbox',
      type: 'project',
      require: session.packages || {},
      config: {
        'sort-packages': true,
        'audit': { abandoned: 'ignore' },
      },
    };
    await fs.writeFile(
      path.join(workDir, 'composer.json'),
      JSON.stringify(composerJson, null, 2),
    );

    // bootstrap that loads vendor if present
    const bootstrap = `<?php
declare(strict_types=1);
$autoload = __DIR__ . '/vendor/autoload.php';
if (is_file($autoload)) {
    require $autoload;
}
require __DIR__ . '/index.php';
`;
    await fs.writeFile(path.join(workDir, 'run.php'), bootstrap);

    return workDir;
  }

  async composerInstall(workDir) {
    const packages = Object.keys(
      JSON.parse(await fs.readFile(path.join(workDir, 'composer.json'), 'utf8')).require || {},
    );
    if (packages.length === 0) {
      return {
        skipped: true,
        ok: true,
        stdout: '',
        stderr: '',
        durationMs: 0,
        exitCode: 0,
        timedOut: false,
      };
    }

    const hostWorkDir = this.hostPathFor(workDir);
    const args = [
      ...dockerBaseArgs(config.composerMemory, 'bridge'),
      '-v',
      `${hostWorkDir}:/app`,
      '-w',
      '/app',
      '-e',
      'COMPOSER_HOME=/tmp/composer',
      '-e',
      'COMPOSER_CACHE_DIR=/tmp/composer-cache',
      '-e',
      'COMPOSER_ALLOW_SUPERUSER=1',
      // composer:2 ENTRYPOINT is already "composer"
      config.composerImage,
      'install',
      '--no-interaction',
      '--no-ansi',
      '--prefer-dist',
      '--no-progress',
      '--ignore-platform-reqs',
    ];

    const result = await runCommand(this.dockerBin, args, {
      timeoutMs: config.composerTimeoutMs,
    });
    return { skipped: false, ...result };
  }

  async executePhp(workDir, phpVersion) {
    const image = config.phpVersions[phpVersion];
    if (!image) {
      throw new Error(`unsupported PHP version: ${phpVersion}`);
    }

    const hostWorkDir = this.hostPathFor(workDir);
    const hostIni = process.env.HOST_PHP_INI_PATH || config.phpIniPath;
    const args = [
      ...dockerBaseArgs(config.memoryLimit, 'none'),
      '-v',
      `${hostWorkDir}:/workspace:ro`,
      '-v',
      `${hostIni}:/usr/local/etc/php/conf.d/zz-sandbox.ini:ro`,
      '-w',
      '/workspace',
      image,
      'php',
      '-d',
      'display_errors=1',
      'run.php',
    ];

    return runCommand(this.dockerBin, args, {
      timeoutMs: config.runTimeoutMs,
    });
  }

  async run(sessionDir, session) {
    const workDir = await this.prepareWorkspace(sessionDir, session);
    const composer = await this.composerInstall(workDir);
    if (!composer.ok && !composer.skipped) {
      return {
        ok: false,
        phase: 'composer',
        phpVersion: session.phpVersion,
        composer,
        execution: null,
        workDir,
      };
    }

    const execution = await this.executePhp(workDir, session.phpVersion);
    return {
      ok: execution.ok,
      phase: execution.ok ? 'done' : 'execution',
      phpVersion: session.phpVersion,
      composer,
      execution,
      workDir,
    };
  }
}
