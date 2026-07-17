import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-vault-use-config');

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

interface RouteResponse {
  status: number;
  body: unknown;
  assert?: (ctx: { url: URL; body: unknown }) => void;
}

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let serverPort = 0;
let program: Command;
const routes: Record<string, RouteResponse> = {};

function setRoute(method: string, path: string, route: RouteResponse): void {
  routes[`${method} ${path}`] = route;
}

function clearRoutes(): void {
  for (const key of Object.keys(routes)) {
    delete routes[key];
  }
}

function writeAuthConfig(port: number): void {
  const authPath = join(testConfigDir, 'auth.json');
  writeFileSync(
    authPath,
    JSON.stringify({ token: 'test-token', apiUrl: `http://localhost:${port}` }),
  );
}

class ExitError extends Error {
  constructor(public code?: number) {
    super(`process.exit(${code})`);
  }
}

async function runProgram(args: string[]): Promise<number | undefined> {
  const origExit = process.exit;
  let exitCode: number | undefined;
  process.exit = ((code?: number) => {
    exitCode = code;
    throw new ExitError(code);
  }) as typeof process.exit;
  try {
    await program.parseAsync(['node', 'anima', ...args]);
  } catch (error) {
    if (!(error instanceof ExitError)) throw error;
  } finally {
    process.exit = origExit;
  }
  return exitCode;
}

const USE_RESULT = {
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: '{"ok":true}',
  truncated: false,
};

describe('vault use command', () => {
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
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true });
    }

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const key = `${req.method} ${url.pathname}`;
        const route = routes[key];

        if (!route) {
          return new Response(
            JSON.stringify({ error: { code: 'NOT_FOUND', message: `Not Found: ${key}` } }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }

        let body: unknown;
        const text = await req.text();
        if (text) body = JSON.parse(text);
        route.assert?.({ url, body });

        return new Response(JSON.stringify(route.body), {
          status: route.status,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    mockServer = server;
    serverPort = server.port ?? 0;

    writeAuthConfig(serverPort);
  });

  afterEach(() => {
    mockServer?.stop();
    mockServer = null;
    clearRoutes();
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  test('use posts the brokered call under /v1 and prints the upstream result', async () => {
    let seenBody: Record<string, unknown> | undefined;
    setRoute('POST', '/v1/vault/credentials/cred_1/use', {
      status: 200,
      body: USE_RESULT,
      assert: ({ body }) => {
        seenBody = body as Record<string, unknown>;
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    const code = await runProgram([
      '--json',
      'vault',
      'use',
      '--credential',
      'cred_1',
      '--method',
      'post',
      '--url',
      'https://api.stripe.com/v1/charges',
      '-H',
      'X-Idempotency: abc',
      '-H',
      'X-Trace: 1',
      '--body',
      '{"amount":100}',
    ]);

    console.log = originalLog;

    expect(code).toBeUndefined();
    // Method is normalized to uppercase; headers collect across repeats.
    expect(seenBody?.method).toBe('POST');
    expect(seenBody?.url).toBe('https://api.stripe.com/v1/charges');
    expect(seenBody?.headers).toEqual({ 'X-Idempotency': 'abc', 'X-Trace': '1' });
    expect(seenBody?.body).toBe('{"amount":100}');

    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('"status": 200');
    expect(printed).toContain('{\\"ok\\":true}');
  });

  test('use prints the raw upstream body without --json (pipeable)', async () => {
    setRoute('POST', '/v1/vault/credentials/cred_1/use', {
      status: 200,
      body: USE_RESULT,
    });

    const writeSpy = mock((chunk: unknown) => true);
    const originalWrite = process.stdout.write;
    process.stdout.write = writeSpy as unknown as typeof process.stdout.write;

    const code = await runProgram([
      'vault',
      'use',
      '--credential',
      'cred_1',
      '--url',
      'https://api.stripe.com/v1/charges',
    ]);

    process.stdout.write = originalWrite;

    expect(code).toBeUndefined();
    // The raw upstream body is the ONLY thing written to stdout (pipeable) —
    // the status line is human-only, suppressed when stdout is not a TTY.
    const printed = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(printed).toContain('{"ok":true}');
  });

  test('use surfaces a 403 (missing vault:use scope / access) and exits 1', async () => {
    setRoute('POST', '/v1/vault/credentials/cred_1/use', {
      status: 403,
      body: {
        error: { code: 'FORBIDDEN', message: 'API key is missing required scope(s): vault:use' },
      },
    });

    const errSpy = mock((...args: unknown[]) => {});
    const originalErr = console.error;
    console.error = errSpy;

    const code = await runProgram([
      'vault',
      'use',
      '--credential',
      'cred_1',
      '--url',
      'https://api.stripe.com/v1/charges',
    ]);

    console.error = originalErr;

    expect(code).toBe(1);
    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('vault:use');
  });

  test('secret refs mint and exchange under /v1 (regression: bare paths 404)', async () => {
    // resolveSecretRefs drives `vault exec` env injection; its raw ApiClient
    // does NOT prepend /v1, so the paths themselves must carry it.
    const { resolveSecretRefs } = await import('../../lib/secret-ref.js');
    const { ApiClient } = await import('../../lib/api-client.js');

    setRoute('POST', '/v1/vault/token', {
      status: 200,
      body: { token: 'vtk_test' },
    });
    setRoute('POST', '/v1/vault/token/exchange', {
      status: 200,
      body: {
        id: 'cred_1',
        type: 'api_key',
        name: 'k',
        apiKey: { provider: 'p', key: 'sk_secret' },
      },
    });

    const client = new ApiClient({ baseUrl: `http://localhost:${serverPort}`, token: 't' });
    const resolved = await resolveSecretRefs(client, {
      MY_KEY: { source: 'anima', credentialId: 'cred_1', field: 'apiKey.key' },
    });

    expect(resolved.errors).toEqual([]);
    expect(resolved.values.MY_KEY).toBe('sk_secret');
  });
});
