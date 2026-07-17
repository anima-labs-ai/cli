import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-vault-store-config');

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
  writeFileSync(
    join(testConfigDir, 'auth.json'),
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

describe('vault store --type api_key', () => {
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

  test('stores an api_key with broker config and reveal policy under /v1', async () => {
    let seenBody: Record<string, unknown> | undefined;
    setRoute('POST', '/v1/vault/credentials', {
      status: 200,
      body: {
        id: 'cred_1',
        type: 'api_key',
        name: 'Stripe key',
        revealPolicy: 'brokered',
        apiKey: { provider: 'stripe', key: 'sk_****1234', allowedHosts: ['api.stripe.com'] },
      },
      assert: ({ body }) => {
        seenBody = body as Record<string, unknown>;
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    const code = await runProgram([
      '--json',
      'vault',
      'store',
      '--type',
      'api_key',
      '--name',
      'Stripe key',
      '--provider',
      'stripe',
      '--key',
      'sk_live_x',
      '--allowed-host',
      'api.stripe.com',
      '--allowed-host',
      'files.stripe.com',
      '--auth-scheme',
      'Bearer ',
      '--reveal-policy',
      'brokered',
    ]);

    console.log = originalLog;

    expect(code).toBeUndefined();
    const apiKey = seenBody?.apiKey as Record<string, unknown>;
    expect(apiKey.provider).toBe('stripe');
    expect(apiKey.key).toBe('sk_live_x');
    expect(apiKey.allowedHosts).toEqual(['api.stripe.com', 'files.stripe.com']);
    expect(apiKey.authScheme).toBe('Bearer ');
    expect(seenBody?.revealPolicy).toBe('brokered');
  });

  test('api_key requires --provider and --key', async () => {
    const errSpy = mock((...args: unknown[]) => {});
    const originalErr = console.error;
    console.error = errSpy;

    const code = await runProgram(['vault', 'store', '--type', 'api_key', '--name', 'K']);

    console.error = originalErr;
    expect(code).toBe(1);
    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('--provider');
  });
});
