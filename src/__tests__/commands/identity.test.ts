import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-identity-config');

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
  writeFileSync(authPath, JSON.stringify({ token: 'test-token', apiUrl: `http://localhost:${port}` }));
}

async function runProgram(args: string[]): Promise<void> {
  try {
    await program.parseAsync(['node', 'anima', ...args]);
  } catch {
  }
}

describe('identity commands', () => {
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
          return new Response(JSON.stringify({ error: { message: 'Not Found' } }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        let body: unknown = undefined;
        if (req.method !== 'GET' && req.method !== 'DELETE') {
          const bodyText = await req.text();
          const contentType = req.headers.get('content-type') ?? '';
          if (bodyText && contentType.includes('application/json')) {
            body = JSON.parse(bodyText) as unknown;
          }
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

  test('create identity sends required body', async () => {
    setRoute('POST', '/agents', {
      status: 201,
      body: {
        id: 'agt_1',
        orgId: 'org_1',
        name: 'Bot One',
        slug: 'bot-one',
        email: 'bot@acme.test',
        status: 'ACTIVE',
      },
      assert: ({ body }) => {
        expect(body).toEqual({
          orgId: 'org_1',
          name: 'Bot One',
          slug: 'bot-one',
          email: 'bot@acme.test',
          provisionPhone: true,
          metadata: { team: 'sales' },
        });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'identity',
      'create',
      '--org', 'org_1',
      '--name', 'Bot One',
      '--slug', 'bot-one',
      '--email', 'bot@acme.test',
      '--provision-phone',
      '--metadata', '{"team":"sales"}',
    ]);

    console.log = originalLog;

    expect(logSpy.mock.calls.length).toBe(1);
    const printed = logSpy.mock.calls.at(0)?.at(0);
    expect(typeof printed).toBe('string');
    const parsed = JSON.parse(String(printed)) as { id: string; slug: string };
    expect(parsed.id).toBe('agt_1');
    expect(parsed.slug).toBe('bot-one');
  });

  test('list identities supports filters and pagination options', async () => {
    setRoute('GET', '/agents', {
      status: 200,
      body: {
        items: [
          {
            id: 'agt_1',
            orgId: 'org_1',
            name: 'Bot One',
            slug: 'bot-one',
            email: 'bot1@acme.test',
            status: 'ACTIVE',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nextCursor: 'cursor_2',
        hasMore: true,
        total: 42,
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('orgId')).toBe('org_1');
        expect(url.searchParams.get('limit')).toBe('10');
        expect(url.searchParams.get('cursor')).toBe('cursor_1');
        expect(url.searchParams.get('status')).toBe('ACTIVE');
        expect(url.searchParams.get('query')).toBe('bot');
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      'identity',
      'list',
      '--org', 'org_1',
      '--limit', '10',
      '--cursor', 'cursor_1',
      '--status', 'ACTIVE',
      '--query', 'bot',
    ]);

    console.log = originalLog;

    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('cursor_2')).toBe(true);
    expect(output.includes('Has more: yes')).toBe(true);
  });

  test('get identity fetches by id', async () => {
    setRoute('GET', '/agents/agt_1', {
      status: 200,
      body: {
        id: 'agt_1',
        orgId: 'org_1',
        name: 'Bot One',
        slug: 'bot-one',
        status: 'ACTIVE',
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'identity', 'get', '--id', 'agt_1']);

    console.log = originalLog;

    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0))) as { id: string; orgId: string };
    expect(parsed.id).toBe('agt_1');
    expect(parsed.orgId).toBe('org_1');
  });

  test('update identity sends patch body', async () => {
    setRoute('PATCH', '/agents/agt_1', {
      status: 200,
      body: {
        id: 'agt_1',
        orgId: 'org_1',
        name: 'Bot One Updated',
        slug: 'bot-one-updated',
        status: 'SUSPENDED',
        metadata: { owner: 'ops' },
      },
      assert: ({ body }) => {
        expect(body).toEqual({
          id: 'agt_1',
          name: 'Bot One Updated',
          slug: 'bot-one-updated',
          status: 'SUSPENDED',
          metadata: { owner: 'ops' },
        });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'identity',
      'update',
      '--id', 'agt_1',
      '--name', 'Bot One Updated',
      '--slug', 'bot-one-updated',
      '--status', 'SUSPENDED',
      '--metadata', '{"owner":"ops"}',
    ]);

    console.log = originalLog;

    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0))) as { status: string; slug: string };
    expect(parsed.status).toBe('SUSPENDED');
    expect(parsed.slug).toBe('bot-one-updated');
  });

  test('delete identity calls delete endpoint', async () => {
    setRoute('DELETE', '/agents/agt_1', {
      status: 200,
      body: { deleted: true },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['identity', 'delete', '--id', 'agt_1']);

    console.log = originalLog;

    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Identity deleted: agt_1')).toBe(true);
  });

  test('rotate-key rotates API key', async () => {
    setRoute('POST', '/agents/agt_1/rotate-key', {
      status: 200,
      body: {
        id: 'agt_1',
        apiKey: 'sk_rotated_123',
        rotatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'identity', 'rotate-key', '--id', 'agt_1']);

    console.log = originalLog;

    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0))) as { id: string; apiKey: string };
    expect(parsed.id).toBe('agt_1');
    expect(parsed.apiKey).toBe('sk_rotated_123');
  });

  test('handles ApiError with user-friendly message', async () => {
    setRoute('GET', '/agents/missing', {
      status: 404,
      body: {
        error: {
          code: 'NOT_FOUND',
          message: 'agent not found',
        },
      },
    });

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runProgram(['identity', 'get', '--id', 'missing']);

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Identity not found.')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('create identity handles forbidden access (403)', async () => {
    setRoute('POST', '/agents', {
      status: 403,
      body: {
        error: {
          code: 'FORBIDDEN',
          message: 'no access',
        },
      },
    });

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runProgram([
      'identity',
      'create',
      '--org', 'org_1',
      '--name', 'Bot One',
      '--slug', 'bot-one',
    ]);

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Forbidden: you do not have access to this organization.')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('list identities handles rate limiting (429)', async () => {
    setRoute('GET', '/agents', {
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

    await runProgram(['identity', 'list', '--org', 'org_1']);

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to list identities: Too many requests')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('get identity handles malformed JSON response', async () => {
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
    writeAuthConfig(serverPort);

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runProgram(['identity', 'get', '--id', 'agt_1']);

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to get identity:')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('rotate-key handles network connection refused', async () => {
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

    await runProgram(['identity', 'rotate-key', '--id', 'agt_1']);

    globalThis.fetch = originalFetch;
    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to rotate identity API key: Network error: Connection refused')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('delete identity handles timeout', async () => {
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

    await runProgram(['identity', 'delete', '--id', 'agt_1']);

    globalThis.fetch = originalFetch;
    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to delete identity: Request timed out')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
