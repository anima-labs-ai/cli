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

  test('member invite sends correct request and uses default org', async () => {
    startMockServer();
    setupAuthConfig();
    writeDefaultOrgConfig('org_default');
    setRoute('POST', '/v1/admin/orgs/org_default/members', {
      status: 200,
      body: { email: 'dev@acme.test', role: 'admin', invited: true },
      assert: ({ body }) => {
        expect(body).toEqual({ email: 'dev@acme.test', role: 'admin' });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['admin', 'member', 'invite', '--email', 'dev@acme.test', '--role', 'admin']);

    console.log = originalLog;
    const printed = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(printed.includes('Invited dev@acme.test')).toBe(true);
  });

  test('member invite honors ANIMA_DEFAULT_ORG when no --org or config default', async () => {
    startMockServer();
    setupAuthConfig();
    process.env.ANIMA_DEFAULT_ORG = 'org_env';
    setRoute('POST', '/v1/admin/orgs/org_env/members', {
      status: 200,
      body: { email: 'dev@acme.test', role: 'admin', invited: true },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await runProgram(['admin', 'member', 'invite', '--email', 'dev@acme.test', '--role', 'admin']);
      const printed = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
      expect(printed.includes('Invited dev@acme.test')).toBe(true);
    } finally {
      console.log = originalLog;
      delete process.env.ANIMA_DEFAULT_ORG;
    }
  });

  test('member role change sends correct request', async () => {
    startMockServer();
    setupAuthConfig();
    setRoute('PUT', '/v1/admin/orgs/org_1/members/dev%40acme.test', {
      status: 200,
      body: { email: 'dev@acme.test', role: 'viewer' },
      assert: ({ body }) => {
        expect(body).toEqual({ role: 'viewer' });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      'admin', 'member', 'role',
      '--org', 'org_1',
      '--email', 'dev@acme.test',
      '--role', 'viewer',
    ]);

    console.log = originalLog;
    const printed = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(printed.includes('Updated dev@acme.test role to viewer')).toBe(true);
  });

  test('key rotate shows new key', async () => {
    startMockServer();
    setupAuthConfig();
    setRoute('POST', '/v1/admin/keys/rotate', {
      status: 200,
      body: { keyId: 'key_2', key: 'sk_live_rotated_123' },
      assert: ({ body }) => {
        expect(body).toEqual({ org: 'org_1' });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'admin', 'key', 'rotate', '--org', 'org_1']);

    console.log = originalLog;
    const jsonOutput = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0))) as { key: string; keyId: string };
    expect(jsonOutput.key).toBe('sk_live_rotated_123');
    expect(jsonOutput.keyId).toBe('key_2');
  });

  test('key revoke sends correct request', async () => {
    startMockServer();
    setupAuthConfig();
    setRoute('POST', '/v1/admin/keys/revoke', {
      status: 200,
      body: { revoked: true, keyId: 'key_1' },
      assert: ({ body }) => {
        expect(body).toEqual({ keyId: 'key_1' });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['admin', 'key', 'revoke', '--key-id', 'key_1', '--yes']);

    console.log = originalLog;
    const printed = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(printed.includes('Revoked API key key_1')).toBe(true);
  });

  test('usage displays summary', async () => {
    startMockServer();
    setupAuthConfig();
    setRoute('GET', '/v1/admin/orgs/org_1/usage', {
      status: 200,
      body: { identities: 8, emails: 121, storage: '2.1 GB' },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['admin', 'usage', '--org', 'org_1']);

    console.log = originalLog;
    const printed = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(printed.includes('121')).toBe(true);
    expect(printed.includes('2.1 GB')).toBe(true);
  });

  test('errors when no org specified and no default', async () => {
    startMockServer();
    setupAuthConfig();

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitCode = await runProgram(['admin', 'member', 'invite', '--email', 'dev@acme.test']);

    console.error = originalError;
    const printed = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(exitCode).toBe(1);
    expect(printed.includes("No org specified. Use --org <org> or set default with 'anima config set defaultOrg <org>'")).toBe(true);
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
