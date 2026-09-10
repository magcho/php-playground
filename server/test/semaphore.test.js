import test from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore } from '../src/services/semaphore.js';

test('Semaphore limits concurrency and rejects when queue is full', async () => {
  const sem = new Semaphore(1, 1);
  const release1 = await sem.acquire();
  assert.equal(sem.snapshot().active, 1);

  let secondReleased = false;
  const secondPromise = sem.acquire().then((release) => {
    secondReleased = true;
    return release;
  });

  // Queue is full (1 active + 1 waiting) — next acquire must fail.
  await assert.rejects(() => sem.acquire(), (err) => err.code === 'RUNNER_BUSY');

  release1();
  const release2 = await secondPromise;
  assert.equal(secondReleased, true);
  release2();
  assert.equal(sem.snapshot().active, 0);
  assert.equal(sem.snapshot().queued, 0);
});
