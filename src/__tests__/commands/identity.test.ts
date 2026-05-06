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

// Real-looking CUIDs so the contract's z.string().cuid() input validation
// in the typed oRPC client doesn't reject the test args before the request
// ever hits the mock server.
const AGENT_ID_1 = 'caaa00000000000000000agt01';
const ORG_ID_1 = 'caaa00000000000000000org01';
const CURSOR_1 = 'caaa00000000000000000cur01';
const CURSOR_2 = 'caaa00000000000000000cur02';
const MISSING_ID = 'caaa00000000000000000miss1';

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

// Build a complete AgentOutput-shaped response. Required because oRPC
// contracts derive the output type from a Zod schema; partial mock
// responses lead to undefined fields when commands access typed fields
// like `agent.emailIdentities`.
function buildAgentResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: AGENT_ID_1,
    orgId: ORG_ID_1,
    name: 'Bot One',
    slug: 'bot-one',
    status: 'ACTIVE',
    apiKeyPrefix: 'ak_test',
    keyRotatedAt: null,
    metadata: {},
    emailIdentities: [],
    phoneIdentities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
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

        if (process.env.ANIMA_TEST_DEBUG) {
          console.error(`[mock-server] ${req.method} ${url.pathname}${url.search}`);
        }

        if (!route) {
          return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not Found' } }), {
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
      body: buildAgentResponse({ name: 'Bot One', slug: 'bot-one' }),
      assert: ({ body }) => {
        expect(body).toMatchObject({
          orgId: ORG_ID_1,
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
      '--org', ORG_ID_1,
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
    expect(parsed.id).toBe(AGENT_ID_1);
    expect(parsed.slug).toBe('bot-one');
  });

  test('list identities supports filters and pagination options', async () => {
    setRoute('GET', '/agents', {
      status: 200,
      body: {
        items: [buildAgentResponse({ name: 'Bot One', slug: 'bot-one' })],
        pagination: {
          nextCursor: CURSOR_2,
          hasMore: true,
        },
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('orgId')).toBe(ORG_ID_1);
        expect(url.searchParams.get('limit')).toBe('10');
        expect(url.searchParams.get('cursor')).toBe(CURSOR_1);
        expect(url.searchParams.get('status')).toBe('ACTIVE');
        expect(url.searchParams.get('query')).toBe('bot');
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--human',
      'identity',
      'list',
      '--org', ORG_ID_1,
      '--limit', '10',
      '--cursor', CURSOR_1,
      '--status', 'ACTIVE',
      '--query', 'bot',
    ]);

    console.log = originalLog;

    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes(CURSOR_2)).toBe(true);
    expect(output.includes('Has more: yes')).toBe(true);
  });

  test('get identity fetches by id', async () => {
    setRoute('GET', `/agents/${AGENT_ID_1}`, {
      status: 200,
      body: buildAgentResponse(),
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'identity', 'get', '--id', AGENT_ID_1]);

    console.log = originalLog;

    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0))) as {
      id: string;
      orgId: string;
    };
    expect(parsed.id).toBe(AGENT_ID_1);
    expect(parsed.orgId).toBe(ORG_ID_1);
  });

  test('update identity sends patch body', async () => {
    setRoute('PATCH', `/agents/${AGENT_ID_1}`, {
      status: 200,
      body: buildAgentResponse({
        name: 'Bot One Updated',
        slug: 'bot-one-updated',
        status: 'SUSPENDED',
        metadata: { owner: 'ops' },
      }),
      assert: ({ body }) => {
        // oRPC OpenAPILink lifts the contract's path param `{id}` into the
        // URL (PATCH /agents/<id>) and omits it from the request body.
        expect(body).toMatchObject({
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
      '--id', AGENT_ID_1,
      '--name', 'Bot One Updated',
      '--slug', 'bot-one-updated',
      '--status', 'SUSPENDED',
      '--metadata', '{"owner":"ops"}',
    ]);

    console.log = originalLog;

    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0))) as {
      status: string;
      slug: string;
    };
    expect(parsed.status).toBe('SUSPENDED');
    expect(parsed.slug).toBe('bot-one-updated');
  });

  test('delete identity calls delete endpoint', async () => {
    setRoute('DELETE', `/agents/${AGENT_ID_1}`, {
      status: 200,
      body: { success: true },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['identity', 'delete', '--id', AGENT_ID_1]);

    console.log = originalLog;

    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes(`Identity deleted: ${AGENT_ID_1}`)).toBe(true);
  });

  test('rotate-key rotates API key', async () => {
    setRoute('POST', `/agents/${AGENT_ID_1}/rotate-key`, {
      status: 200,
      body: {
        apiKey: 'sk_rotated_123',
        apiKeyPrefix: 'sk_rota',
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'identity', 'rotate-key', '--id', AGENT_ID_1]);

    console.log = originalLog;

    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0))) as {
      apiKey: string;
      apiKeyPrefix: string;
    };
    expect(parsed.apiKey).toBe('sk_rotated_123');
    expect(parsed.apiKeyPrefix).toBe('sk_rota');
  });

  test('handles 404 with user-friendly message', async () => {
    setRoute('GET', `/agents/${MISSING_ID}`, {
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

    await runProgram(['identity', 'get', '--id', MISSING_ID]);

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
      '--org', ORG_ID_1,
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

    await runProgram(['identity', 'list', '--org', ORG_ID_1]);

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to list identities: Too many requests')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
