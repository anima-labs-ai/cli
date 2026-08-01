import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createProgram } from '../../cli.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-admin-config');

mock.module('env-paths', () => ({
  default: () => ({
    config: testConfigDir,
    data: testConfigDir,
    cache: testConfigDir,
    log: testConfigDir,
    temp: testConfigDir,
  }),
}));

interface RouteResponse {
  status: number;
  body: unknown;
  assert?: (ctx: { url: URL; body: unknown }) => void;
}

class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`exit:${code}`);
  }
}

describe('admin commands', () => {
  let program: Command;
  let mockServer: ReturnType<typeof Bun.serve> | null = null;
  let serverPort = 0;
  const routes: Record<string, RouteResponse> = {};
  const requestLog: string[] = [];

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
  });

  afterEach(() => {
    mockServer?.stop();
    mockServer = null;
    for (const key of Object.keys(routes)) {
      delete routes[key];
    }
    requestLog.length = 0;
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  function setupAuthConfig(): void {
    writeFileSync(join(testConfigDir, 'auth.json'), JSON.stringify({
      token: 'test-token',
      apiUrl: `http://localhost:${serverPort}`,
    }, null, 2));
  }

  function writeDefaultOrgConfig(defaultOrg: string): void {
    writeFileSync(join(testConfigDir, 'config.json'), JSON.stringify({ defaultOrg }, null, 2));
  }

  function startMockServer(): void {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        requestLog.push(`${req.method} ${url.pathname}`);
        const route = routes[`${req.method} ${url.pathname}`];
        if (!route) {
          return new Response(JSON.stringify({ error: { message: 'Not found' } }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        let body: unknown = undefined;
        if (req.method !== 'GET') {
          const raw = await req.text();
          if (raw.length > 0) {
            body = JSON.parse(raw) as unknown;
          }
        }

        route.assert?.({ url, body });

        return new Response(JSON.stringify(route.body), {
          status: route.status,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    mockServer = server;
    serverPort = server.port ?? 0;
  }

  function setRoute(method: string, path: string, route: RouteResponse): void {
    routes[`${method} ${path}`] = route;
  }

  async function runProgram(args: string[]): Promise<number | null> {
    const originalExit = process.exit;
    const mockExit: typeof process.exit = (code?: number | string | null | undefined): never => {
      throw new ExitError(Number(code ?? 0));
    };
    process.exit = mockExit;

    try {
      await program.parseAsync(['node', 'anima', ...args]);
      return null;
    } catch (err: unknown) {
      if (err instanceof ExitError) {
        return err.code;
      }
      return null;
    } finally {
      process.exit = originalExit;
    }
  }

  /**
   * `admin org list` used to GET /v1/admin/orgs, and this test used to mock
   * exactly that. The route does not exist in the API — there is no
   * `/v1/admin/*` namespace at all — so the command answered "Route not found"
   * for every real user while the suite stayed green against an endpoint the
   * mock had invented. Pointing the mock at the endpoint the CLI actually
   * calls is the part that makes this test worth having.
   */
  test('org list displays the org the credential is scoped to', async () => {
    startMockServer();
    setupAuthConfig();
    setRoute('GET', '/v1/orgs/me', {
      status: 200,
      body: { id: 'org_1', name: 'Acme', slug: 'acme', tier: 'PRO' },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['admin', 'org', 'list']);

    console.log = originalLog;
    const printed = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(printed.includes('Acme')).toBe(true);
    expect(printed.includes('org_1')).toBe(true);
  });

  /**
   * Membership is Clerk's, not ours. `/v1/admin/orgs/{org}/members` never
   * existed, and the contract exposes only `GET /orgs/{id}/members` — no
   * writes at all. These tests used to mock the POST and pass, which is how
   * two commands that could only ever answer "Route not found" survived.
   */
  test('member invite refuses locally and points at the console', async () => {
    startMockServer();
    setupAuthConfig();
    writeDefaultOrgConfig('org_default');

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitCode = await runProgram([
      'admin', 'member', 'invite', '--email', 'dev@acme.test', '--role', 'admin',
    ]);

    console.error = originalError;
    const printed = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(exitCode).toBe(1);
    expect(printed.includes('not available from the CLI')).toBe(true);
    // The point of failing locally: no doomed request goes out.
    expect(requestLog.length).toBe(0);
  });

  test('member role change refuses locally and points at the console', async () => {
    startMockServer();
    setupAuthConfig();

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitCode = await runProgram([
      'admin', 'member', 'role', '--org', 'org_1', '--email', 'dev@acme.test', '--role', 'viewer',
    ]);

    console.error = originalError;
    const printed = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(exitCode).toBe(1);
    expect(printed.includes('not available from the CLI')).toBe(true);
    expect(requestLog.length).toBe(0);
  });

  test('key rotate shows new key', async () => {
    startMockServer();
    setupAuthConfig();
    setRoute('POST', '/v1/orgs/org_1/rotate-key', {
      status: 200,
      body: { masterKey: 'mk_live_rotated_123' },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'admin', 'key', 'rotate', '--org', 'org_1']);

    console.log = originalLog;
    const jsonOutput = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0))) as { masterKey: string };
    expect(jsonOutput.masterKey).toBe('mk_live_rotated_123');
  });

  test('key revoke sends correct request', async () => {
    startMockServer();
    setupAuthConfig();
    // The id is now part of the path, not the body — DELETE /api-keys/{id}.
    setRoute('DELETE', '/v1/api-keys/key_1', {
      status: 200,
      body: { success: true },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['admin', 'key', 'revoke', '--key-id', 'key_1', '--yes']);

    console.log = originalLog;
    const printed = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    // No `--human`: tests resolve to the `agent` format, which is what a piped
    // or scripted caller gets. The command emits the API's response as a
    // structured document there — asserting the prose instead would only
    // prove the human path, which is not the path a script takes.
    expect(JSON.parse(printed.trim().split('\n').at(-1) as string)).toMatchObject({
      success: true,
    });
  });

  test('usage displays the period rollup', async () => {
    startMockServer();
    setupAuthConfig();
    // `/orgs/me/usage` returns an open record of counters, not the fixed
    // identities/emails/storage triple the dead /v1/admin route was mocked to.
    setRoute('GET', '/v1/orgs/me/usage', {
      status: 200,
      body: {
        period: '2026-07',
        updatedAt: '2026-07-29T10:00:00.000Z',
        totals: { emails_sent: 121, agents: 8 },
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['admin', 'usage']);

    console.log = originalLog;
    const printed = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(printed.includes('121')).toBe(true);
    expect(printed.includes('2026-07')).toBe(true);
  });

  test('usage refuses an --org that is not the one this credential is scoped to', async () => {
    startMockServer();
    setupAuthConfig();
    writeDefaultOrgConfig('org_default');

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    // The endpoint derives the org from the credential, so a different --org
    // cannot be honored. Saying so beats silently reporting the wrong org's
    // numbers under the heading the caller asked for.
    const exitCode = await runProgram(['admin', 'usage', '--org', 'org_other']);

    console.error = originalError;
    const printed = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(exitCode).toBe(2);
    expect(printed.includes('org_default')).toBe(true);
  });

  test('shows API failure message on forbidden response', async () => {
    startMockServer();
    setupAuthConfig();
    setRoute('GET', '/v1/orgs/me', {
      status: 403,
      body: { error: { code: 'FORBIDDEN', message: 'forbidden' } },
    });

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitCode = await runProgram(['admin', 'org', 'list']);

    console.error = originalError;
    const printed = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(exitCode).toBe(1);
    expect(printed.includes('forbidden')).toBe(true);
  });

  test('errors when not authenticated', async () => {
    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitCode = await runProgram(['admin', 'org', 'list']);

    console.error = originalError;
    const printed = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(exitCode).toBe(1);
    expect(printed.includes('Not authenticated. Run `anima auth login` to authenticate.')).toBe(true);
  });

  test('key revoke requires confirmation', async () => {
    startMockServer();
    setupAuthConfig();

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitCode = await runProgram(['admin', 'key', 'revoke', '--key-id', 'key_1']);

    console.error = originalError;
    const printed = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(exitCode).toBe(1);
    expect(printed.includes('Confirmation required. Re-run with --yes to revoke the key.')).toBe(true);
  });
});
