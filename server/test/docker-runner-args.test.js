import test from 'node:test';
import assert from 'node:assert/strict';
import { DockerRunner } from '../src/services/docker-runner.js';

test('buildPhpArgs includes --runtime runsc', () => {
  const runner = new DockerRunner({ phpRuntime: 'runsc' });
  const args = runner.buildPhpArgs('/host/data/sessions/x/runs/y', '8.3');
  const runtimeIdx = args.indexOf('--runtime');
  assert.ok(runtimeIdx >= 0, 'expected --runtime');
  assert.equal(args[runtimeIdx + 1], 'runsc');
  assert.ok(args.includes('php:8.3-cli'));
  assert.ok(args.includes('none'));
});

test('buildComposerArgs does not set --runtime', () => {
  const runner = new DockerRunner({ phpRuntime: 'runsc' });
  const args = runner.buildComposerArgs('/host/data/sessions/x/runs/y');
  assert.equal(args.includes('--runtime'), false);
  assert.ok(args.includes('composer:2'));
  assert.ok(args.includes('bridge'));
});
