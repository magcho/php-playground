import { spawn } from 'node:child_process';

/**
 * Run a command and capture stdout/stderr with timeout.
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs?: number, env?: NodeJS.ProcessEnv }} options
 */
export function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 512_000) stdout = stdout.slice(0, 512_000) + '\n...[truncated]';
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 512_000) stderr = stderr.slice(0, 512_000) + '\n...[truncated]';
    });

    child.on('error', (err) => {
      finish({
        ok: false,
        exitCode: -1,
        stdout,
        stderr: stderr || err.message,
        timedOut: false,
        durationMs: Date.now() - started,
      });
    });

    child.on('close', (code, signal) => {
      finish({
        ok: !killed && code === 0,
        exitCode: killed ? 124 : code ?? (signal ? 1 : 0),
        stdout,
        stderr: killed
          ? `${stderr}\n[timeout after ${timeoutMs}ms]`.trim()
          : stderr,
        timedOut: killed,
        durationMs: Date.now() - started,
      });
    });
  });
}
