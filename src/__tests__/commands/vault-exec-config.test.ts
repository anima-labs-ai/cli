import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { runCapturingExit } from '../helpers/test-utils.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-vault-exec-config');

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

const missingConfig = join(testConfigDir, 'nope', 'anima.json');
const realConfig = join(testConfigDir, 'custom-anima.json');

describe('vault exec --config', () => {
  let program: Command;
  let mockServer: ReturnType<typeof Bun.serve> | null = null;

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
    writeFileSync(
      realConfig,
      JSON.stringify({ secrets: { FROM_CUSTOM_CONFIG: { source: 'env', name: 'HOST_VALUE' } } }),
    );

    // exec calls requireAuth before it ever reads the config, so without a
    // credential every one of these tests would exit on auth and "pass" for
    // the wrong reason.
    mockServer = Bun.serve({ port: 0, fetch: () => new Response('{}', { status: 200 }) });
    writeFileSync(
      join(testConfigDir, 'auth.json'),
      JSON.stringify({ token: 'test-token', apiUrl: `http://localhost:${mockServer.port}` }),
    );
  });

  afterEach(() => {
    mockServer?.stop();
    mockServer = null;
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  // `--config` was declared but `opts.config` was never read — exec always
  // auto-discovered from cwd. So pointing it at a file that does not exist
  // ran the child anyway with none of the secrets the caller asked for, and
  // pointing it at a real file silently used a different one.
  test('fails when the named config file does not exist', async () => {
    const result = await runCapturingExit(program, [
      'vault',
      'exec',
      '--config',
      missingConfig,
      '--dry-run',
      '--',
      'echo',
      'hi',
    ]);

    expect(result.code).toBe(2);
  });

  test('reads secrets from the named config file', async () => {
    process.env.HOST_VALUE = 'from-host-env';
    try {
      const result = await runCapturingExit(program, [
        'vault',
        'exec',
        '--config',
        realConfig,
        '--dry-run',
        '--',
        'echo',
        'hi',
      ]);

      expect(result.logs.join('\n')).toContain('FROM_CUSTOM_CONFIG');
    } finally {
      delete process.env.HOST_VALUE;
    }
  });
});
