import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { createProgram } from '../../cli.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';

const testConfigDir = join(tmpdir(), `am-test-vault-${Date.now()}`);

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

function getBaseUrl(): string {
  return `http://localhost:${serverPort}`;
}

async function runCli(args: string[]): Promise<void> {
  try {
    await program.parseAsync(['node', 'anima', '--token', 'test-token', '--api-url', getBaseUrl(), ...args]);
  } catch {
  }
}

describe('vault commands', () => {
  beforeEach(() => {
    resetPathsCache();
    setPathsOverride({
      config: testConfigDir,
      data: testConfigDir,
      cache: testConfigDir,
      log: testConfigDir,
      temp: testConfigDir,
    });
    mkdirSync(testConfigDir, { recursive: true });
    program = createProgram();

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const route = routes[`${req.method} ${url.pathname}`];

        if (!route) {
          return new Response(JSON.stringify({ error: { message: 'Not Found' } }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        let body: unknown = undefined;
        const bodyText = await req.text();
        const contentType = req.headers.get('content-type') ?? '';
        if (bodyText && contentType.includes('application/json')) {
          body = JSON.parse(bodyText) as unknown;
        }

        route.assert?.({ url, body });

        return new Response(route.status === 204 ? null : JSON.stringify(route.body), {
          status: route.status,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    mockServer = server;
    serverPort = server.port ?? 0;
  });

  afterEach(() => {
    mockServer?.stop();
    mockServer = null;
    clearRoutes();
    try { rmSync(testConfigDir, { recursive: true, force: true }); } catch {}
  });

  test('vault provision sends expected body', async () => {
    setRoute('POST', '/vault/provision', {
      status: 200,
      body: {
        id: 'vault_1',
        agentId: 'agent_1',
        orgId: 'org_1',
        vaultUserId: 'user_1',
        vaultOrgId: 'vorg_1',
        collectionId: 'col_1',
        status: 'ACTIVE',
        credentialCount: 0,
        lastSyncAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      assert: ({ body }) => {
        expect(body).toEqual({ agentId: 'agent_1' });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['vault', 'provision', '--agent', 'agent_1']);

    console.log = originalLog;
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault deprovision sends expected body', async () => {
    setRoute('POST', '/vault/deprovision', {
      status: 200,
      body: { success: true },
      assert: ({ body }) => {
        expect(body).toEqual({ agentId: 'agent_1' });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['vault', 'deprovision', '--agent', 'agent_1']);

    console.log = originalLog;
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault status sends expected query and supports json', async () => {
    setRoute('GET', '/vault/status', {
      status: 200,
      body: {
        serverUrl: 'http://localhost:8222',
        lastSync: '2026-01-01T00:00:00.000Z',
        status: 'unlocked',
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('agentId')).toBe('agent_1');
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['--json', 'vault', 'status', '--agent', 'agent_1']);

    console.log = originalLog;

    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0) ?? '{}')) as { status: string };
    expect(parsed.status).toBe('unlocked');
  });

  test('vault sync sends expected body', async () => {
    setRoute('POST', '/vault/sync', {
      status: 200,
      body: { success: true },
      assert: ({ body }) => {
        expect(body).toEqual({ agentId: 'agent_1' });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['vault', 'sync', '--agent', 'agent_1']);

    console.log = originalLog;
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault store login sends expected body', async () => {
    setRoute('POST', '/vault/credentials', {
      status: 200,
      body: {
        id: 'cred_1',
        type: 'login',
        name: 'GitHub',
        login: {
          username: 'octocat',
          password: 'secret',
          uris: [{ uri: 'https://github.com' }],
        },
        favorite: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      assert: ({ body }) => {
        expect(body).toEqual({
          agentId: 'agent_1',
          type: 'login',
          name: 'GitHub',
          login: {
            username: 'octocat',
            password: 'secret',
            uris: [{ uri: 'https://github.com' }],
          },
        });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli([
      '--json',
      'vault',
      'store',
      '--agent',
      'agent_1',
      '--type',
      'login',
      '--name',
      'GitHub',
      '--username',
      'octocat',
      '--password',
      'secret',
      '--uri',
      'https://github.com',
    ]);

    console.log = originalLog;
    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0) ?? '{}')) as { id: string };
    expect(parsed.id).toBe('cred_1');
  });

  test('vault get fetches credential by id with agent query', async () => {
    setRoute('GET', '/vault/credentials/cred_1', {
      status: 200,
      body: {
        id: 'cred_1',
        type: 'login',
        name: 'GitHub',
        login: { username: 'octocat' },
        favorite: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('agentId')).toBe('agent_1');
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['--json', 'vault', 'get', 'cred_1', '--agent', 'agent_1']);

    console.log = originalLog;
    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0) ?? '{}')) as { id: string };
    expect(parsed.id).toBe('cred_1');
  });

  test('vault list calls credentials endpoint and renders output', async () => {
    setRoute('GET', '/vault/credentials', {
      status: 200,
      body: {
        items: [
          {
            id: 'cred_1',
            type: 'login',
            name: 'GitHub',
            login: { username: 'octocat' },
            favorite: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('agentId')).toBe('agent_1');
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['vault', 'list', '--agent', 'agent_1']);

    console.log = originalLog;
    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('cred_1')).toBe(true);
  });

  test('vault search calls search endpoint with filters', async () => {
    setRoute('GET', '/vault/search', {
      status: 200,
      body: {
        items: [
          {
            id: 'cred_2',
            type: 'login',
            name: 'GitHub Account',
            login: { username: 'octocat' },
            favorite: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('agentId')).toBe('agent_1');
        expect(url.searchParams.get('search')).toBe('github');
        expect(url.searchParams.get('type')).toBe('login');
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['vault', 'search', '--agent', 'agent_1', '--query', 'github', '--type', 'login']);

    console.log = originalLog;
    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('cred_2')).toBe(true);
  });

  test('vault delete calls delete endpoint with query params', async () => {
    setRoute('DELETE', '/vault/credentials/cred_1', {
      status: 200,
      body: { success: true },
      assert: ({ body }) => {
        expect(body).toEqual({ agentId: 'agent_1' });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['vault', 'delete', 'cred_1', '--agent', 'agent_1']);

    console.log = originalLog;
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault generate sends requested options and prints password', async () => {
    setRoute('POST', '/vault/generate-password', {
      status: 200,
      body: { password: 'xK9!mP2@nL5#' },
      assert: ({ body }) => {
        expect(body).toEqual({
          agentId: 'agent_1',
          length: 16,
          uppercase: true,
          lowercase: true,
          number: true,
          special: true,
        });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli([
      'vault',
      'generate',
      '--agent',
      'agent_1',
      '--length',
      '16',
      '--uppercase',
      '--lowercase',
      '--numbers',
      '--special',
    ]);

    console.log = originalLog;
    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('xK9!mP2@nL5#')).toBe(true);
  });

  test('vault totp fetches code and period', async () => {
    setRoute('GET', '/vault/totp/cred_1', {
      status: 200,
      body: { code: '123456', period: 30 },
      assert: ({ url }) => {
        expect(url.searchParams.get('agentId')).toBe('agent_1');
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['vault', 'totp', 'cred_1', '--agent', 'agent_1']);

    console.log = originalLog;
    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('123456')).toBe(true);
    expect(output.includes('30')).toBe(true);
  });

  test('vault commands handle ApiError with friendly message', async () => {
    setRoute('POST', '/vault/provision', {
      status: 400,
      body: {
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid agent',
        },
      },
    });

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runCli(['vault', 'provision', '--agent', 'bad_agent']);

    console.error = originalError;
    process.exit = originalExit;

    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    expect(String(errorSpy.mock.calls.at(0)?.at(0) ?? '')).toContain('Failed to provision vault: Invalid agent');
  });

  test('vault list handles 429 rate limiting', async () => {
    setRoute('GET', '/vault/credentials', {
      status: 429,
      body: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
        },
      },
    });

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runCli(['vault', 'list', '--agent', 'agent_1']);

    console.error = originalError;
    process.exit = originalExit;

    const output = String(errorSpy.mock.calls.at(0)?.at(0) ?? '');
    expect(output).toContain('Failed to list credentials: Too many requests');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault get handles 503 server unavailable', async () => {
    setRoute('GET', '/vault/credentials/cred_1', {
      status: 503,
      body: {
        error: {
          code: 'UNAVAILABLE',
          message: 'Service unavailable',
        },
      },
    });

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runCli(['vault', 'get', 'cred_1', '--agent', 'agent_1']);

    console.error = originalError;
    process.exit = originalExit;

    const output = String(errorSpy.mock.calls.at(0)?.at(0) ?? '');
    expect(output).toContain('Failed to get credential: Service unavailable');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault search handles malformed JSON response', async () => {
    mockServer?.stop();
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response('{ bad json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    serverPort = mockServer.port ?? 0;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runCli(['vault', 'search', '--agent', 'agent_1', '--query', 'x']);

    console.error = originalError;
    process.exit = originalExit;

    const output = String(errorSpy.mock.calls.at(0)?.at(0) ?? '');
    expect(output).toContain('Failed to search credentials:');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault provision handles network connection refused', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new TypeError('Connection refused');
    }) as unknown as typeof fetch;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runCli(['vault', 'provision', '--agent', 'agent_1']);

    globalThis.fetch = originalFetch;
    console.error = originalError;
    process.exit = originalExit;

    const output = String(errorSpy.mock.calls.at(0)?.at(0) ?? '');
    expect(output).toContain('Failed to provision vault: Network error: Connection refused');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault delete handles timeout abort', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runCli(['vault', 'delete', 'cred_1', '--agent', 'agent_1']);

    globalThis.fetch = originalFetch;
    console.error = originalError;
    process.exit = originalExit;

    const output = String(errorSpy.mock.calls.at(0)?.at(0) ?? '');
    expect(output).toContain('Failed to delete credential: Request timed out');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
