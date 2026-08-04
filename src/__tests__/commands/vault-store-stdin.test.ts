import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { runCapturingExit } from '../helpers/test-utils.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-vault-store-stdin-config');

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

const SECRET = 'SUPERSECRET_FROM_STDIN_123';

function feedStdin(text: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(text, 'utf-8');
      },
    },
  });
  return () => {
    if (original) Object.defineProperty(process, 'stdin', original);
  };
}

/**
 * `--password` and `--key` put the secret in argv, where it lands in shell
 * history and is readable by any process that can run `ps` for as long as the
 * command runs. A credential manager should not require that to store a
 * credential.
 */
describe('vault store reads secrets from stdin', () => {
  let program: Command;
  let mockServer: ReturnType<typeof Bun.serve> | null = null;
  let lastBody: Record<string, unknown> | undefined;
  let restoreStdin: (() => void) | null = null;

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

    lastBody = undefined;
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const text = await req.text();
        if (text) lastBody = JSON.parse(text) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ id: 'cred_1', type: 'api_key', name: 'X', apiKey: {} }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });
    writeFileSync(
      join(testConfigDir, 'auth.json'),
      JSON.stringify({ token: 'test-token', apiUrl: `http://localhost:${mockServer.port}` }),
    );
  });

  afterEach(() => {
    restoreStdin?.();
    restoreStdin = null;
    mockServer?.stop();
    mockServer = null;
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  test('--key-stdin sends the secret read from stdin', async () => {
    restoreStdin = feedStdin(`${SECRET}\n`);

    await runCapturingExit(program, [
      'vault',
      'store',
      '--name',
      'X',
      '--type',
      'api_key',
      '--provider',
      'openai',
      '--key-stdin',
      '--allowed-host',
      'api.openai.com',
    ]);

    expect((lastBody?.apiKey as Record<string, unknown> | undefined)?.key).toBe(SECRET);
  });

  test('--password-stdin sends the secret read from stdin', async () => {
    restoreStdin = feedStdin(`${SECRET}\n`);

    await runCapturingExit(program, [
      'vault',
      'store',
      '--name',
      'X',
      '--username',
      'alice',
      '--password-stdin',
    ]);

    const login = lastBody?.login as Record<string, unknown> | undefined;
    expect(login?.password).toBe(SECRET);
  });

  // Only one stdin to go around.
  test('--password-stdin and --key-stdin together are rejected', async () => {
    restoreStdin = feedStdin(`${SECRET}\n`);

    const result = await runCapturingExit(program, [
      'vault',
      'store',
      '--name',
      'X',
      '--type',
      'api_key',
      '--provider',
      'openai',
      '--key-stdin',
      '--password-stdin',
    ]);

    expect(result.code).toBe(1);
  });
});
