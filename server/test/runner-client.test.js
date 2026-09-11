import test from 'node:test';
import assert from 'node:assert/strict';
import { RunnerClient } from '../src/services/runner-client.js';

test('RunnerClient.run maps successful response', async () => {
  const client = new RunnerClient({
    baseUrl: 'http://runner.test',
    token: 'tok',
    fetchFn: async (url, init) => {
      assert.equal(url, 'http://runner.test/v1/run');
      assert.equal(init.headers.Authorization, 'Bearer tok');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            phase: 'done',
            phpVersion: '8.3',
            composer: { skipped: true, ok: true },
            execution: { ok: true, stdout: 'hi', stderr: '', exitCode: 0 },
          };
        },
      };
    },
  });

  const result = await client.run({
    sessionId: '11111111-1111-4111-8111-111111111111',
    phpVersion: '8.3',
    code: '<?php echo 1;',
    packages: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.phase, 'done');
  assert.equal(result.execution.stdout, 'hi');
});

test('RunnerClient.run throws RUNNER_UNAVAILABLE on network error', async () => {
  const client = new RunnerClient({
    baseUrl: 'http://runner.test',
    token: 'tok',
    fetchFn: async () => {
      throw new Error('ECONNREFUSED');
    },
  });

  await assert.rejects(
    () => client.run({ sessionId: 'x', phpVersion: '8.3', code: '', packages: {} }),
    (err) => err.code === 'RUNNER_UNAVAILABLE',
  );
});

test('RunnerClient.run throws RUNNER_UNAVAILABLE on 401', async () => {
  const client = new RunnerClient({
    baseUrl: 'http://runner.test',
    token: 'bad',
    fetchFn: async () => ({
      ok: false,
      status: 401,
      async json() {
        return { error: 'unauthorized' };
      },
    }),
  });

  await assert.rejects(
    () => client.run({ sessionId: 'x', phpVersion: '8.3', code: '', packages: {} }),
    (err) => err.code === 'RUNNER_UNAVAILABLE',
  );
});

test('RunnerClient.health preserves runtime error from 503 body', async () => {
  const client = new RunnerClient({
    baseUrl: 'http://runner.test',
    token: 'tok',
    fetchFn: async () => ({
      ok: false,
      status: 503,
      async json() {
        return {
          ok: false,
          docker: { ok: true, version: '27.0.0' },
          runtime: { php: 'runsc', ok: false, error: 'docker runtime "runsc" is not registered' },
        };
      },
    }),
  });

  const health = await client.health();
  assert.equal(health.ok, false);
  assert.equal(health.runtime.ok, false);
  assert.match(health.error, /runsc/);
});
