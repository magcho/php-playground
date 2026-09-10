import test from 'node:test';
import assert from 'node:assert/strict';
import { runnerTokenError } from '../src/lib/token.js';

test('runnerTokenError rejects placeholders', () => {
  assert.ok(runnerTokenError(''));
  assert.ok(runnerTokenError('change-me-to-a-long-random-string'));
  assert.ok(runnerTokenError('short'));
  assert.equal(runnerTokenError('a'.repeat(16)), null);
});
