import { config } from '../config.js';

export class RunnerClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || config.runnerUrl).replace(/\/$/, '');
    this.token = options.token ?? config.runnerToken;
    this.fetchFn = options.fetchFn || fetch;
    this.timeoutMs =
      options.timeoutMs ||
      config.composerTimeoutMs + config.runTimeoutMs + 5_000;
  }

  headers() {
    const headers = { Accept: 'application/json' };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  async health() {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(5_000),
      });
      let body = {};
      try {
        body = await res.json();
      } catch {
        /* ignore non-JSON */
      }
      if (!res.ok) {
        return {
          ...body,
          ok: false,
          status: res.status,
          error: body.error || body.runtime?.error || 'runner health failed',
        };
      }
      return { ok: Boolean(body.ok), ...body };
    } catch (err) {
      return { ok: false, error: err.message || 'runner unavailable' };
    }
  }

  async run(payload) {
    let res;
    try {
      res = await this.fetchFn(`${this.baseUrl}/v1/run`, {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const error = new Error('runner unavailable');
      error.code = 'RUNNER_UNAVAILABLE';
      error.cause = err;
      throw error;
    }

    if (res.status === 401) {
      const error = new Error('runner unavailable');
      error.code = 'RUNNER_UNAVAILABLE';
      throw error;
    }

    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body.error || '';
      } catch {
        /* ignore */
      }
      if (res.status >= 500) {
        const error = new Error('runner unavailable');
        error.code = 'RUNNER_UNAVAILABLE';
        throw error;
      }
      const error = new Error(detail || `runner error (${res.status})`);
      error.code = 'RUNNER_BAD_REQUEST';
      error.status = res.status;
      throw error;
    }

    return res.json();
  }
}
