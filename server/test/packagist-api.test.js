import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApiRouter } from '../src/routes/api.js';

test('GET /packagist/versions validation', async (t) => {
  const router = createApiRouter({
    sessions: {},
    runner: {},
  });
  const app = express();
  app.use(router);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => server.close());

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  await t.test('returns 400 when package param is missing', async () => {
    const res = await fetch(`${baseUrl}/packagist/versions`);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, 'invalid package name');
  });

  await t.test('returns 400 when package name has invalid format', async () => {
    const invalidNames = ['foo', 'foo//bar', 'foo/bar/baz', '../foo/bar', 'foo/bar?baz'];
    for (const name of invalidNames) {
      const res = await fetch(`${baseUrl}/packagist/versions?package=${encodeURIComponent(name)}`);
      assert.equal(res.status, 400, `Expected 400 for ${name}`);
    }
  });
});
