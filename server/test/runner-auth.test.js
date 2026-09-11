import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { config } from '../src/config.js';
import { requireRunnerToken } from '../src/routes/runner-api.js';

test('requireRunnerToken rejects missing bearer', async () => {
  config.runnerToken = 'secret-token';

  const app = express();
  app.get('/t', requireRunnerToken, (_req, res) => res.json({ ok: true }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/t`);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('requireRunnerToken accepts valid bearer', async () => {
  config.runnerToken = 'secret-token';

  const app = express();
  app.get('/t', requireRunnerToken, (_req, res) => res.json({ ok: true }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/t`, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});
