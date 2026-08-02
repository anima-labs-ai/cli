import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command, CommanderError } from 'commander';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-vault-bounds-config');

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

const CRED_ID = 'caaa00000000000000000crd01';

/**
 * Ranges the help text already promises. Where the CLI did not enforce them,
 * the out-of-range value travelled to the server and came back as a bare
 * "Input validation failed" — no flag named, no range quoted — while
 * `vault request create --ttl`, which does validate locally, answers with the
 * exact bound. Same CLI, two qualities of error for the same mistake.
 *
 * Each case also asserts the request never left the process: a bound only the
 * server enforces costs a round trip and puts a doomed attempt in the audit
 * log.
 */
describe('vault numeric and scheme bounds are enforced by the CLI', () => {
  let program: Command;
  let mockServer: ReturnType<typeof Bun.serve> | null = null;
  let reachedServer = false;

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

    reachedServer = false;
    mockServer = Bun.serve({
      port: 0,
      fetch: () => {
        reachedServer = true;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
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

  // Commander is configured with `exitOverride`, so a rejected option parser
  // throws out of `parseAsync` rather than exiting — same shape the empty-id
  // sweep asserts on.
  async function expectRejectedLocally(argv: string[], expected: RegExp): Promise<void> {
    let thrown: unknown;
    try {
      await program.parseAsync(['node', 'anima', ...argv]);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as CommanderError | undefined)?.code).toBe('commander.invalidArgument');
    expect(String((thrown as Error | undefined)?.message)).toMatch(expected);
    expect(reachedServer).toBe(false);
  }

  test('token create rejects a ttl below the documented floor', async () => {
    await expectRejectedLocally(
      ['vault', 'token', 'create', '--credential', CRED_ID, '--ttl', '5'],
      /ttl.*between 10 and 3600/i,
    );
  });

  test('token create rejects a ttl above the documented ceiling', async () => {
    await expectRejectedLocally(
      ['vault', 'token', 'create', '--credential', CRED_ID, '--ttl', '99999'],
      /ttl.*between 10 and 3600/i,
    );
  });

  test('generate rejects a length below the documented floor', async () => {
    await expectRejectedLocally(
      ['vault', 'generate', '--length', '2'],
      /length.*between 4 and 128/i,
    );
  });

  test('generate rejects a length above the documented ceiling', async () => {
    await expectRejectedLocally(
      ['vault', 'generate', '--length', '9999'],
      /length.*between 4 and 128/i,
    );
  });

  test('store rejects a generated-password length outside its own range', async () => {
    await expectRejectedLocally(
      ['vault', 'store', '--name', 'x', '--generate-password', '--length', '4'],
      /length.*between 8 and 128/i,
    );
  });

  // The broker already refuses a non-https target server-side
  // (`insecure_scheme`), so this moves the same answer earlier — before a
  // credential-bearing request is assembled.
  test('use rejects a non-https url before calling the broker', async () => {
    await expectRejectedLocally(
      ['vault', 'use', '--credential', CRED_ID, '--url', 'http://api.example.com/v1'],
      /https/i,
    );
  });

  test('use rejects a url that is not absolute', async () => {
    await expectRejectedLocally(
      ['vault', 'use', '--credential', CRED_ID, '--url', '/v1/models'],
      /absolute/i,
    );
  });

  test('use lets an https url through to the broker', async () => {
    await program
      .parseAsync([
        'node',
        'anima',
        'vault',
        'use',
        '--credential',
        CRED_ID,
        '--url',
        'https://api.example.com/v1',
      ])
      .catch(() => {
        /* the mock's response shape is not what this test is about */
      });

    expect(reachedServer).toBe(true);
  });
});
