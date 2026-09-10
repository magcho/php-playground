import test from 'node:test';
import assert from 'node:assert/strict';
import { DockerRunner } from '../src/services/docker-runner.js';

test('buildPhpArgs includes --runtime runsc and a container name', () => {
  const runner = new DockerRunner({ phpRuntime: 'runsc' });
  const args = runner.buildPhpArgs('/host/data/sessions/x/runs/y', '8.3', 'phbox-php-test');
  const runtimeIdx = args.indexOf('--runtime');
  assert.ok(runtimeIdx >= 0, 'expected --runtime');
  assert.equal(args[runtimeIdx + 1], 'runsc');
  assert.equal(args[args.indexOf('--name') + 1], 'phbox-php-test');
  assert.ok(args.includes('php:8.3-cli'));
  assert.ok(args.includes('none'));
  assert.equal(args.includes('--rm'), false, 'must not use --rm so cleanup can force-remove');
});

test('buildComposerArgs does not set --runtime and disables plugins/scripts', () => {
  const runner = new DockerRunner({ phpRuntime: 'runsc' });
  const args = runner.buildComposerArgs('/host/data/sessions/x/runs/y', 'phbox-composer-test');
  assert.equal(args.includes('--runtime'), false);
  assert.equal(args[args.indexOf('--name') + 1], 'phbox-composer-test');
  assert.ok(args.includes('composer:2'));
  assert.ok(args.includes('bridge'));
  assert.ok(args.includes('--no-plugins'));
  assert.ok(args.includes('--no-scripts'));
  assert.equal(args.includes('--rm'), false);
});
