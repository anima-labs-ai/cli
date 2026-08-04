import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { runCapturingExit } from '../helpers/test-utils.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-vault-agent-status-config');

mock.module('env-paths', () => ({
  default: () => ({
    config: testConfigDir,
    data: testConfigDir,
    cache: testConfigDir,
    log: testConfigDir,
    temp: testConfigDir,
  }),
}));

const { createProgram } = await import('../../cli.js');

describe('vault agent status', () => {
  let program: Command;

  beforeEach(() => {
    resetPathsCache();
    setPathsOverride({
      config: testConfigDir,
      data: testConfigDir,
      cache: testConfigDir,
      log: testConfigDir,
      temp: testConfigDir,
    });
    program = createProgram();
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  // Holds whether or not a daemon happens to be running on this machine — the
  // pid file is a fixed ~/.anima path this test cannot sandbox, so the
  // assertion is deliberately state-independent.
  //
  // "Not running" went out through `output.info`, which renders in the human
  // format only. In the agent format — the default for every non-TTY caller —
  // `status` printed nothing at all and exited 0, so a script could not tell a
  // stopped daemon from a running one.
  test('reports daemon state in the agent format, whatever that state is', async () => {
    const result = await runCapturingExit(program, ['vault', 'agent', 'status']);

    expect(result.logs.join('\n').trim()).not.toBe('');
  });

  test('--json reports daemon state', async () => {
    const result = await runCapturingExit(program, ['--json', 'vault', 'agent', 'status']);

    expect(result.logs.join('\n')).toContain('running');
  });
});
