import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { runCapturingExit } from '../helpers/test-utils.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-vault-inject-config');

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

/** Stand in for piped stdin: `readStdin` only needs an async iterable of chunks. */
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

describe('vault inject', () => {
  let program: Command;
  let mockServer: ReturnType<typeof Bun.serve> | null = null;
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

    // Every route 404s — the credential cannot be resolved.
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Credential not found' } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
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

  // inject exists to turn a reference into a secret. When it cannot, emitting
  // the template verbatim and exiting 0 means the caller pipes the literal
  // string `{{vault:...}}` into whatever consumes it — an auth header, a
  // config file — and only finds out when the far end rejects it. `exec` and
  // `redact` both already fail closed; inject was the odd one out.
  test('exits non-zero when a template cannot be resolved', async () => {
    restoreStdin = feedStdin(`token={{vault:${CRED_ID}:login.password}}`);

    const result = await runCapturingExit(program, ['vault', 'inject']);

    expect(result.code).toBe(1);
  });

  test('names the reference it could not resolve', async () => {
    restoreStdin = feedStdin(`token={{vault:${CRED_ID}:login.password}}`);

    const result = await runCapturingExit(program, ['vault', 'inject']);

    expect(result.errors.join('\n')).toContain(CRED_ID);
  });

  test('does not emit the unresolved template on stdout', async () => {
    restoreStdin = feedStdin(`token={{vault:${CRED_ID}:login.password}}`);

    const result = await runCapturingExit(program, ['vault', 'inject']);

    expect(result.stdout.join('')).not.toContain('{{vault:');
  });

  // Text with no references at all is not a failed injection — it is a no-op,
  // and must stay a clean pass-through so inject is safe to put in a pipeline
  // unconditionally.
  test('passes through text with no references and exits 0', async () => {
    restoreStdin = feedStdin('nothing to see here');

    const result = await runCapturingExit(program, ['vault', 'inject']);

    expect(result.code).toBeUndefined();
  });
});
