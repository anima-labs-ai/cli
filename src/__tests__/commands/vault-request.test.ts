import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-vault-request-config');

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
  body: unknown | (() => unknown);
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

const CREATED = {
  requestId: 'req_1',
  fillUrl: 'https://console.useanima.sh/vault/fill/tok_abc',
  status: 'PENDING',
  expiresAt: '2026-07-14T00:15:00Z',
  emailSent: false,
};

describe('vault request commands', () => {
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

        const responseBody = typeof route.body === 'function' ? route.body() : route.body;
        return new Response(JSON.stringify(responseBody), {
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

  test('request create posts the ask and prints the fill URL — never a secret argument', async () => {
    let seenBody: Record<string, unknown> | undefined;
    setRoute('POST', '/v1/vault/credential-requests', {
      status: 200,
      body: CREATED,
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
      'request',
      'create',
      '--type',
      'api_key',
      '--name',
      'Prod Stripe key',
      '--reason',
      'Deploy needs to verify billing',
      '--ttl',
      '600',
    ]);

    console.log = originalLog;

    expect(code).toBeUndefined();
    expect(seenBody?.type).toBe('api_key');
    expect(seenBody?.name).toBe('Prod Stripe key');
    expect(seenBody?.reason).toBe('Deploy needs to verify billing');
    expect(seenBody?.ttlSeconds).toBe(600);

    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('req_1');
    expect(printed).toContain('https://console.useanima.sh/vault/fill/tok_abc');
  });

  test('request create --wait polls status until FULFILLED', async () => {
    setRoute('POST', '/v1/vault/credential-requests', {
      status: 200,
      body: CREATED,
    });

    let polls = 0;
    setRoute('GET', '/v1/vault/credential-requests/req_1', {
      status: 200,
      body: () => {
        polls += 1;
        return polls < 3
          ? { status: 'PENDING', credentialId: null, maskedPreview: null }
          : { status: 'FULFILLED', credentialId: 'cred_9', maskedPreview: '****1234' };
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    const code = await runProgram([
      '--json',
      'vault',
      'request',
      'create',
      '--type',
      'api_key',
      '--name',
      'k',
      '--reason',
      'r',
      '--wait',
      '--poll-interval',
      '10',
      '--timeout',
      '5',
    ]);

    console.log = originalLog;

    expect(code).toBeUndefined();
    expect(polls).toBe(3);
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('FULFILLED');
    expect(printed).toContain('cred_9');
    // The masked preview is the ONLY shape of the secret that ever comes back.
    expect(printed).toContain('****1234');
  });

  test('request create --wait --json exits non-zero on a non-FULFILLED terminal status', async () => {
    setRoute('POST', '/v1/vault/credential-requests', {
      status: 200,
      body: CREATED,
    });
    setRoute('GET', '/v1/vault/credential-requests/req_1', {
      status: 200,
      body: { status: 'DECLINED', credentialId: null, maskedPreview: null },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    const code = await runProgram([
      '--json',
      'vault',
      'request',
      'create',
      '--type',
      'api_key',
      '--name',
      'k',
      '--reason',
      'r',
      '--wait',
      '--poll-interval',
      '10',
      '--timeout',
      '5',
    ]);

    console.log = originalLog;

    // HITL security: an agent gating on `create --wait --json && next` must NOT
    // proceed when the human declined — the JSON path must still exit non-zero.
    expect(code).toBe(1);
    // ...while still emitting the JSON payload so the agent can see the status.
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('DECLINED');
  });

  test('request status polls once and prints masked state', async () => {
    setRoute('GET', '/v1/vault/credential-requests/req_2', {
      status: 200,
      body: { status: 'FULFILLED', credentialId: 'cred_5', maskedPreview: '****abcd' },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    const code = await runProgram(['--json', 'vault', 'request', 'status', 'req_2']);

    console.log = originalLog;

    expect(code).toBeUndefined();
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('FULFILLED');
    expect(printed).toContain('cred_5');
  });

  test('request cancel posts to /cancel', async () => {
    let hit = false;
    setRoute('POST', '/v1/vault/credential-requests/req_3/cancel', {
      status: 200,
      body: { status: 'CANCELLED' },
      assert: () => {
        hit = true;
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    const code = await runProgram(['--json', 'vault', 'request', 'cancel', 'req_3']);

    console.log = originalLog;

    expect(code).toBeUndefined();
    expect(hit).toBe(true);
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('CANCELLED');
  });

  test('request status 404 (expired) exits 1 with a clear message', async () => {
    setRoute('GET', '/v1/vault/credential-requests/req_gone', {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'request not found' } },
    });

    const errSpy = mock((...args: unknown[]) => {});
    const originalErr = console.error;
    console.error = errSpy;

    const code = await runProgram(['vault', 'request', 'status', 'req_gone']);

    console.error = originalErr;

    expect(code).toBe(1);
    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('not found');
  });
});
