import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command, CommanderError } from 'commander';
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

  // The contract requires orgId; with --org omitted the command resolves it
  // from the configured default org (config.json), not an org.me round-trip.
  test('scan uses the configured default org when --org is omitted', async () => {
    writeFileSync(join(testConfigDir, 'config.json'), JSON.stringify({ defaultOrg: ORG_ID_ME }));
    setRoute('GET', `/v1/orgs/${ORG_ID_ME}/security/scanner-status`, {
      status: 200,
      body: SCANNER_STATUS_BODY,
    });

    const logSpy = mock((...args: unknown[]) => {});
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

    const logSpy = mock((...args: unknown[]) => {});
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

  test('scan honors the ANIMA_DEFAULT_ORG env var over an absent flag/config', async () => {
    // No --org and no config.json defaultOrg — only the env var. Proves the
    // full resolution ladder (flag → env → active profile → top-level), which
    // getConfig().defaultOrg alone did not cover.
    process.env.ANIMA_DEFAULT_ORG = ORG_ID_ME;
    setRoute('GET', `/v1/orgs/${ORG_ID_ME}/security/scanner-status`, {
      status: 200,
      body: SCANNER_STATUS_BODY,
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      const code = await runProgram(['--json', 'security', 'scan']);
      expect(code).toBeUndefined();
      const printed = logSpy.mock.calls.at(-1)?.at(0);
      const parsed = JSON.parse(String(printed)) as typeof SCANNER_STATUS_BODY;
      expect(parsed.aiScanner.active).toBe(true);
    } finally {
      console.log = originalLog;
      delete process.env.ANIMA_DEFAULT_ORG;
    }
  });

  test('events uses the configured default org when --org is omitted', async () => {
    writeFileSync(join(testConfigDir, 'config.json'), JSON.stringify({ defaultOrg: ORG_ID_ME }));
    setRoute('GET', `/v1/orgs/${ORG_ID_ME}/security/events`, {
      status: 200,
      body: EMPTY_EVENTS_BODY,
    });

    const logSpy = mock((...args: unknown[]) => {});
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

  // Regression: `--limit` parsed with `parseInt`, so "20abc" became 20 and
  // "5.5" became 5 — a fat-fingered limit silently paged at a size nobody
  // asked for. It must be rejected as a usage error before any request, the
  // same way the paginated `list` commands reject it (lib/args validateLimit).
  test('events rejects a non-integer --limit before any request', async () => {
    writeFileSync(join(testConfigDir, 'config.json'), JSON.stringify({ defaultOrg: ORG_ID_ME }));
    let eventsRequested = false;
    setRoute('GET', `/v1/orgs/${ORG_ID_ME}/security/events`, {
      status: 200,
      body: EMPTY_EVENTS_BODY,
      assert: () => {
        eventsRequested = true;
      },
    });

    const originalError = console.error;
    const originalWriteErr = process.stderr.write;
    console.error = mock(() => {}) as unknown as typeof console.error;
    process.stderr.write = (() => true) as typeof process.stderr.write;

    let thrown: unknown;
    try {
      await runProgram(['security', 'events', '--limit', '20abc']);
    } catch (error: unknown) {
      thrown = error;
    }

    console.error = originalError;
    process.stderr.write = originalWriteErr;

    // Reported as the usage mistake it is — not truncated into a real page size.
    expect((thrown as CommanderError | undefined)?.code).toBe('commander.invalidArgument');
    // The bad limit never left the CLI.
    expect(eventsRequested).toBe(false);
  });
});
