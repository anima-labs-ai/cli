import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-inbox-config');

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
const INBOX_ID_1 = 'caaa00000000000000000ibx01';
const INBOX_ID_2 = 'caaa00000000000000000ibx02';
const INBOX_ID_3 = 'caaa00000000000000000ibx03';
const AGENT_ID_1 = 'caaa00000000000000000agt01';
const CURSOR_1 = 'caaa00000000000000000cur01';
const CURSOR_2 = 'caaa00000000000000000cur02';

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

// Build a complete InboxOutput-shaped response. Required because oRPC
// contracts derive the output type from a Zod schema; partial mock
// responses lead to undefined fields when commands access typed fields.
function buildInboxResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: INBOX_ID_1,
    email: 'support@agents.useanima.sh',
    domain: 'agents.useanima.sh',
    localPart: 'support',
    displayName: null,
    agentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('inbox commands', () => {
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

  test('inbox create sends expected payload', async () => {
    setRoute('POST', '/v1/inboxes', {
      status: 200,
      body: buildInboxResponse({
        id: INBOX_ID_1,
        email: 'support@example.com',
        domain: 'example.com',
        localPart: 'support',
        displayName: 'Support',
        agentId: AGENT_ID_1,
      }),
      assert: ({ body }) => {
        expect(body).toMatchObject({
          // The CLI lowercases the username before sending (matching the
          // server-side normalization in CreateInboxInput).
          username: 'support',
          domain: 'example.com',
          displayName: 'Support',
          agentId: AGENT_ID_1,
        });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'inbox',
      'create',
      '--username', 'Support',
      '--domain', 'example.com',
      '--display-name', 'Support',
      '--agent', AGENT_ID_1,
    ]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string; email: string };
    expect(parsed.id).toBe(INBOX_ID_1);
    expect(parsed.email).toBe('support@example.com');
  });

  test('inbox create works with no options (server picks defaults)', async () => {
    setRoute('POST', '/v1/inboxes', {
      status: 200,
      body: buildInboxResponse({ id: INBOX_ID_2, email: 'random@agents.useanima.sh' }),
      assert: ({ body }) => {
        // No options → no fields in the payload (undefined values are dropped).
        expect(body ?? {}).toEqual({});
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'inbox', 'create']);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string };
    expect(parsed.id).toBe(INBOX_ID_2);
  });

  test('inbox list sends pagination and query', async () => {
    setRoute('GET', '/v1/inboxes', {
      status: 200,
      body: {
        items: [buildInboxResponse({ id: INBOX_ID_1 })],
        pagination: {
          nextCursor: CURSOR_2,
          hasMore: true,
        },
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('cursor')).toBe(CURSOR_1);
        expect(url.searchParams.get('limit')).toBe('10');
        expect(url.searchParams.get('query')).toBe('support');
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'inbox',
      'list',
      '--cursor', CURSOR_1,
      '--limit', '10',
      '--query', 'support',
    ]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as {
      items: Array<{ id: string }>;
      pagination: { nextCursor: string };
    };
    expect(parsed.items[0]?.id).toBe(INBOX_ID_1);
    expect(parsed.pagination.nextCursor).toBe(CURSOR_2);
  });

  test('inbox get fetches by id', async () => {
    setRoute('GET', `/v1/inboxes/${INBOX_ID_2}`, {
      status: 200,
      body: buildInboxResponse({ id: INBOX_ID_2, agentId: AGENT_ID_1 }),
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'inbox', 'get', INBOX_ID_2]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string; agentId: string };
    expect(parsed.id).toBe(INBOX_ID_2);
    expect(parsed.agentId).toBe(AGENT_ID_1);
  });

  test('inbox update sends display name and agent', async () => {
    setRoute('PATCH', `/v1/inboxes/${INBOX_ID_1}`, {
      status: 200,
      body: buildInboxResponse({ id: INBOX_ID_1, displayName: 'Sales', agentId: AGENT_ID_1 }),
      assert: ({ body }) => {
        // oRPC OpenAPILink lifts the contract's path param `{id}` into the
        // URL (PATCH /inboxes/<id>) and only the remaining fields from
        // UpdateInboxInput travel in the body.
        expect(body).toMatchObject({ displayName: 'Sales', agentId: AGENT_ID_1 });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'inbox',
      'update',
      INBOX_ID_1,
      '--display-name', 'Sales',
      '--agent', AGENT_ID_1,
    ]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string; displayName: string };
    expect(parsed.id).toBe(INBOX_ID_1);
    expect(parsed.displayName).toBe('Sales');
  });

  test('inbox update clear flags send explicit nulls', async () => {
    setRoute('PATCH', `/v1/inboxes/${INBOX_ID_1}`, {
      status: 200,
      body: buildInboxResponse({ id: INBOX_ID_1, displayName: null, agentId: null }),
      assert: ({ body }) => {
        expect(body).toMatchObject({ displayName: null, agentId: null });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'inbox',
      'update',
      INBOX_ID_1,
      '--clear-display-name',
      '--unlink-agent',
    ]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string; displayName: null };
    expect(parsed.id).toBe(INBOX_ID_1);
    expect(parsed.displayName).toBeNull();
  });

  test('inbox update with no flags errors', async () => {
    // NOTE: process.exit is mocked, so execution continues past the guard
    // in tests (the route below keeps the fall-through request harmless).
    // In real usage process.exit(1) terminates before any request is made.
    setRoute('PATCH', `/v1/inboxes/${INBOX_ID_1}`, {
      status: 200,
      body: buildInboxResponse({ id: INBOX_ID_1 }),
    });

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram(['inbox', 'update', INBOX_ID_1]);

    process.exit = originalExit;
    console.error = originalError;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Nothing to update')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('inbox update rejects conflicting display-name flags', async () => {
    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram([
      'inbox',
      'update',
      INBOX_ID_1,
      '--display-name', 'Sales',
      '--clear-display-name',
    ]);

    process.exit = originalExit;
    console.error = originalError;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('--display-name and --clear-display-name are mutually exclusive')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('inbox delete calls delete endpoint', async () => {
    setRoute('DELETE', `/v1/inboxes/${INBOX_ID_3}`, {
      status: 200,
      body: { success: true },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['inbox', 'delete', INBOX_ID_3]);

    console.log = originalLog;

    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes(`Inbox ${INBOX_ID_3} deleted`)).toBe(true);
  });

  test('inbox get handles 404 with friendly message', async () => {
    setRoute('GET', `/v1/inboxes/${INBOX_ID_1}`, {
      status: 404,
      body: {
        error: { code: 'NOT_FOUND', message: 'inbox not found' },
      },
    });

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram(['inbox', 'get', INBOX_ID_1]);

    process.exit = originalExit;
    console.error = originalError;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Inbox not found.')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('inbox create handles 409 conflict with friendly message', async () => {
    setRoute('POST', '/v1/inboxes', {
      status: 409,
      body: {
        error: { code: 'CONFLICT', message: 'address already exists' },
      },
    });

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram(['inbox', 'create', '--username', 'taken']);

    process.exit = originalExit;
    console.error = originalError;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Inbox address already exists')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('inbox list handles api errors with friendly message', async () => {
    setRoute('GET', '/v1/inboxes', {
      status: 503,
      body: {
        error: { code: 'UNAVAILABLE', message: 'Service unavailable' },
      },
    });

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram(['inbox', 'list']);

    process.exit = originalExit;
    console.error = originalError;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to list inboxes: Service unavailable')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('inbox commands are registered in help output', () => {
    const inbox = program.commands.find((cmd) => cmd.name() === 'inbox');
    expect(inbox).toBeDefined();
    const subcommands = (inbox?.commands ?? []).map((cmd) => cmd.name());
    expect(subcommands).toContain('create');
    expect(subcommands).toContain('get');
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('update');
    expect(subcommands).toContain('delete');
  });
});
