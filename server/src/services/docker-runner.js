import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { runCommand } from './process.js';

function dockerBaseArgs(memory, network) {
  // Intentionally omit --rm so we can always docker rm -f by name on timeout.
  return [
    'run',
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
    '--cap-drop',
    'ALL',
  ];
}

export class DockerRunner {
  constructor(options = {}) {
    this.dockerBin = options.dockerBin || process.env.DOCKER_BIN || 'docker';
    this.phpRuntime = options.phpRuntime || config.phpRuntime;
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

  /**
   * Probe whether the configured PHP runtime (gVisor runsc) is registered.
   * Does not fall back to runc.
   */
  async checkPhpRuntime() {
    const runtime = this.phpRuntime;
    const info = await runCommand(this.dockerBin, ['info', '--format', '{{json .Runtimes}}'], {
      timeoutMs: 10_000,
    });
    if (!info.ok) {
      return {
        php: runtime,
        ok: false,
        error: info.stderr || info.stdout || 'docker info failed',
      };
    }
    let runtimes = {};
    try {
      runtimes = JSON.parse(info.stdout.trim() || '{}');
    } catch {
      return { php: runtime, ok: false, error: 'failed to parse docker runtimes' };
    }
    const ok = Object.prototype.hasOwnProperty.call(runtimes, runtime);
    return {
      php: runtime,
      ok,
      error: ok ? null : `docker runtime "${runtime}" is not registered`,
    };
  }

  hostPathFor(containerPath) {
    const rel = path.relative(config.dataDir, containerPath);
    if (rel.startsWith('..')) {
      throw new Error('workspace path escapes data dir');
    }
    return path.join(config.hostDataDir, rel);
  }

  buildComposerArgs(hostWorkDir, containerName) {
    return [
      ...dockerBaseArgs(config.composerMemory, 'bridge'),
      '--name',
      containerName,
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
      '--no-plugins',
      '--no-scripts',
    ];
  }

  buildPhpArgs(hostWorkDir, phpVersion, containerName) {
    const image = config.phpVersions[phpVersion];
    if (!image) {
      throw new Error(`unsupported PHP version: ${phpVersion}`);
    }
    const hostIni = process.env.HOST_PHP_INI_PATH || config.phpIniPath;
    return [
      ...dockerBaseArgs(config.memoryLimit, 'none'),
      '--name',
      containerName,
      '--runtime',
      this.phpRuntime,
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
  }

  async forceRemoveContainer(containerName) {
    if (!containerName) return;
    await runCommand(this.dockerBin, ['rm', '-f', containerName], {
      timeoutMs: 15_000,
    });
  }

  /**
   * Run a docker container by unique name and always remove it afterwards.
   * On CLI timeout, force-removes the container so it cannot keep burning CPU.
   */
  async runNamedContainer(args, timeoutMs) {
    const nameIdx = args.indexOf('--name');
    const containerName = nameIdx >= 0 ? args[nameIdx + 1] : null;
    try {
      return await runCommand(this.dockerBin, args, {
        timeoutMs,
        onTimeout: () => this.forceRemoveContainer(containerName),
      });
    } finally {
      await this.forceRemoveContainer(containerName);
    }
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
        audit: { abandoned: 'ignore' },
        'allow-plugins': false,
      },
    };
    await fs.writeFile(
      path.join(workDir, 'composer.json'),
      JSON.stringify(composerJson, null, 2),
    );

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
    const containerName = `phbox-composer-${randomUUID()}`;
    const args = this.buildComposerArgs(hostWorkDir, containerName);
    const result = await this.runNamedContainer(args, config.composerTimeoutMs);
    return { skipped: false, ...result };
  }

  async executePhp(workDir, phpVersion) {
    const hostWorkDir = this.hostPathFor(workDir);
    const containerName = `phbox-php-${randomUUID()}`;
    const args = this.buildPhpArgs(hostWorkDir, phpVersion, containerName);
    return this.runNamedContainer(args, config.runTimeoutMs);
  }

  async removeWorkDir(workDir) {
    if (!workDir) return;
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  /**
   * Approximate session disk usage under sessions/<id>.
   */
  async sessionDiskBytes(sessionDir) {
    let total = 0;
    async function walk(dir) {
      let entries = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          try {
            const st = await fs.stat(full);
            total += st.size;
          } catch {
            /* ignore */
          }
        }
      }
    }
    await walk(sessionDir);
    return total;
  }

  async run(sessionDir, session) {
    const used = await this.sessionDiskBytes(sessionDir);
    if (used > config.maxSessionDiskBytes) {
      const err = new Error(
        `session disk quota exceeded (${used} > ${config.maxSessionDiskBytes} bytes)`,
      );
      err.code = 'DISK_QUOTA';
      throw err;
    }

    const workDir = await this.prepareWorkspace(sessionDir, session);
    try {
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
    } finally {
      // Drop vendor/code artifacts immediately after the run to bound disk use.
      await this.removeWorkDir(workDir);
    }
  }
}
