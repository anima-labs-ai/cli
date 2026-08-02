import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command, CommanderError } from 'commander';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-vault-exec-scrub-config');

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

const animaConfig = join(testConfigDir, 'anima.json');
const SECRET = 'SUPERSECRET_VALUE_1234567890';

/**
 * Scrubbing is the whole reason `exec` can hand a secret to a child without
 * the caller seeing it. `--no-scrub` turned that off, which made
 * `am vault exec --no-scrub --cred X --as V -- sh -c 'echo $V'` a one-line
 * plaintext read for anyone who already had vault access — the never-see
 * property was opt-out by a single flag. The flag is gone; these tests keep it
 * gone.
 */
describe('vault exec always scrubs', () => {
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
      animaConfig,
      JSON.stringify({ secrets: { LEAKY: { source: 'env', name: 'HOST_SECRET' } } }),
    );

    mockServer = Bun.serve({ port: 0, fetch: () => new Response('{}', { status: 200 }) });
    writeFileSync(
      join(testConfigDir, 'auth.json'),
      JSON.stringify({ token: 'test-token', apiUrl: `http://localhost:${mockServer.port}` }),
    );
  });

  afterEach(() => {
    mockServer?.stop();
    mockServer = null;
    delete process.env.HOST_SECRET;
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  test('--no-scrub is not a recognised option', async () => {
    process.env.HOST_SECRET = SECRET;

    let thrown: unknown;
    try {
      await program.parseAsync([
        'node',
        'anima',
        'vault',
        'exec',
        '--config',
        animaConfig,
        '--no-scrub',
        '--',
        'echo',
        'hi',
      ]);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as CommanderError | undefined)?.code).toBe('commander.unknownOption');
  });

  // Run the real CLI: the redaction happens on the child's stdout pipe, which
  // an in-process `parseAsync` cannot observe — the action resolves before the
  // spawned child has written anything.
  test('the child receives the secret but its stdout is redacted', async () => {
    const proc = Bun.spawn(
      [
        'bun',
        join(import.meta.dir, '..', '..', 'cli.ts'),
        'vault',
        'exec',
        '--config',
        animaConfig,
        '--',
        'sh',
        '-c',
        'echo VALUE=$LEAKY',
      ],
      {
        env: {
          ...process.env,
          HOST_SECRET: SECRET,
          ANIMA_API_KEY: 'ak_test',
          ANIMA_API_URL: `http://localhost:${mockServer?.port}`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    const emitted = await new Response(proc.stdout).text();
    await proc.exited;

    // The child could read it, so the feature still works…
    expect(emitted).toContain('VALUE=');
    // …but the plaintext never reached this process's stdout.
    expect(emitted).not.toContain(SECRET);
    expect(emitted).toContain('[REDACTED]');
  });
});
