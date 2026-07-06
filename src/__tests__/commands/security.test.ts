import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-security-config');

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

const ORG_ID_ME = 'caaa00000000000000000org01';
const ORG_ID_FLAG = 'caaa00000000000000000org02';

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
  writeFileSync(authPath, JSON.stringify({ token: 'test-token', apiUrl: `http://localhost:${port}` }));
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

const ORG_ME_BODY = { id: ORG_ID_ME, name: 'Test Org', slug: 'test-org', tier: 'FREE' };

const SCANNER_STATUS_BODY = {
  aiScanner: { active: true, provider: 'anthropic', fallbackReason: null },
};

const EMPTY_EVENTS_BODY = {
  items: [],
  pagination: { nextCursor: null, hasMore: false },
};

describe('security commands', () => {
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
          return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not Found' } }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        route.assert?.({ url, body: undefined });

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

  // The contract requires orgId; the --org flag promises "derived from auth
  // if omitted", so the command must resolve the org via org.me first.
  test('scan derives orgId from auth when --org is omitted', async () => {
    setRoute('GET', '/v1/orgs/me', { status: 200, body: ORG_ME_BODY });
    setRoute('GET', `/v1/orgs/${ORG_ID_ME}/security/scanner-status`, {
      status: 200,
      body: SCANNER_STATUS_BODY,
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    const code = await runProgram(['--json', 'security', 'scan']);

    console.log = originalLog;

    expect(code).toBeUndefined();
    const printed = logSpy.mock.calls.at(-1)?.at(0);
    expect(typeof printed).toBe('string');
    const parsed = JSON.parse(String(printed)) as typeof SCANNER_STATUS_BODY;
    expect(parsed.aiScanner.active).toBe(true);
    expect(parsed.aiScanner.provider).toBe('anthropic');
  });

  test('scan uses the explicit --org without calling org.me', async () => {
    // No /v1/orgs/me route registered — hitting it would 404 and fail the run.
    setRoute('GET', `/v1/orgs/${ORG_ID_FLAG}/security/scanner-status`, {
      status: 200,
      body: SCANNER_STATUS_BODY,
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    const code = await runProgram(['--json', 'security', 'scan', '--org', ORG_ID_FLAG]);

    console.log = originalLog;

    expect(code).toBeUndefined();
    const printed = logSpy.mock.calls.at(-1)?.at(0);
    expect(typeof printed).toBe('string');
    const parsed = JSON.parse(String(printed)) as typeof SCANNER_STATUS_BODY;
    expect(parsed.aiScanner.active).toBe(true);
  });

  test('events derives orgId from auth when --org is omitted', async () => {
    setRoute('GET', '/v1/orgs/me', { status: 200, body: ORG_ME_BODY });
    setRoute('GET', `/v1/orgs/${ORG_ID_ME}/security/events`, {
      status: 200,
      body: EMPTY_EVENTS_BODY,
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    const code = await runProgram(['--json', 'security', 'events']);

    console.log = originalLog;

    expect(code).toBeUndefined();
    const printed = logSpy.mock.calls.at(-1)?.at(0);
    expect(typeof printed).toBe('string');
    const parsed = JSON.parse(String(printed)) as typeof EMPTY_EVENTS_BODY;
    expect(parsed.items).toEqual([]);
    expect(parsed.pagination.hasMore).toBe(false);
  });
});
