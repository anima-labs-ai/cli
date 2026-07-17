/**
 * Intent tests for `anima email search` (competitive-parity item B11).
 *
 * Semantic search (/messages/search/semantic, real pgvector) was reachable
 * from ZERO clients — the differentiator was invisible. These tests pin:
 *   1. plain mode → POST /messages/search, always scoped to channel EMAIL
 *      (this is the email surface; unscoped search lives at `message search`),
 *   2. --semantic → POST /messages/search/semantic with the contract's
 *      limit/threshold semantics,
 *   3. mode-specific flags FAIL LOUDLY in the wrong mode — a silently
 *      ignored --threshold would lie about what ran,
 *   4. embedding-provider outage (503) is explained, not rendered as a
 *      generic failure (the server distinguishes outage from no-results).
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-email-search-config');

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
const MESSAGE_ID_1 = 'caaa00000000000000000msg01';
const MESSAGE_ID_2 = 'caaa00000000000000000msg02';
const AGENT_ID_1 = 'caaa00000000000000000agt01';
const CURSOR_1 = 'caaa00000000000000000cur01';

interface RouteResponse {
  status: number;
  body: unknown;
  assert?: (ctx: { url: URL; body: unknown }) => void;
}

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let serverPort = 0;
let program: Command;
const routes: Record<string, RouteResponse> = {};
let requestCount = 0;

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

// Build a complete MessageOutput-shaped response. Required because oRPC
// contracts derive the output type from a Zod schema; partial mock
// responses lead to undefined fields when commands access typed fields.
function buildMessageResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MESSAGE_ID_1,
    agentId: AGENT_ID_1,
    channel: 'EMAIL',
    direction: 'INBOUND',
    status: 'DELIVERED',
    fromAddress: 'human@example.com',
    toAddress: 'agent@agents.useanima.sh',
    subject: 'Invoice #42',
    body: 'Please find the invoice attached.',
    bodyHtml: null,
    headers: null,
    metadata: null,
    threadId: null,
    labels: ['unread'],
    inReplyTo: null,
    externalId: null,
    sentAt: null,
    receivedAt: '2026-01-01T00:00:00.000Z',
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildSemanticResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MESSAGE_ID_1,
    content: 'Please find the invoice attached.',
    similarity: 0.91,
    channel: 'email',
    direction: 'inbound',
    createdAt: '2026-01-01T00:00:00.000Z',
    agentId: AGENT_ID_1,
    ...overrides,
  };
}

describe('email search command', () => {
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
    requestCount = 0;
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true });
    }

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        requestCount++;
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

  test('plain search hits /messages/search scoped to the EMAIL channel', async () => {
    setRoute('POST', '/v1/messages/search', {
      status: 200,
      body: {
        items: [buildMessageResponse()],
        pagination: { nextCursor: null, hasMore: false },
      },
      assert: ({ body }) => {
        expect(body).toMatchObject({
          query: 'invoice',
          filters: { channel: 'EMAIL' },
          pagination: { limit: 20 },
        });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'email', 'search', 'invoice']);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { items: Array<{ id: string }> };
    expect(parsed.items[0]?.id).toBe(MESSAGE_ID_1);
  });

  test('plain search forwards filters, cursor and limit', async () => {
    setRoute('POST', '/v1/messages/search', {
      status: 200,
      body: {
        items: [buildMessageResponse({ id: MESSAGE_ID_2 })],
        pagination: { nextCursor: null, hasMore: false },
      },
      assert: ({ body }) => {
        expect(body).toMatchObject({
          query: 'refund',
          filters: {
            channel: 'EMAIL',
            agentId: AGENT_ID_1,
            direction: 'INBOUND',
            status: 'DELIVERED',
          },
          pagination: { cursor: CURSOR_1, limit: 100 },
        });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'email', 'search', 'refund',
      '--agent', AGENT_ID_1,
      '--direction', 'inbound',
      '--status', 'delivered',
      '--cursor', CURSOR_1,
      '--limit', '100',
    ]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { items: Array<{ id: string }> };
    expect(parsed.items[0]?.id).toBe(MESSAGE_ID_2);
  });

  test('plain search carries repeated --label and --include-spam into filters', async () => {
    setRoute('POST', '/v1/messages/search', {
      status: 200,
      body: {
        items: [buildMessageResponse({ labels: ['unread', 'urgent'] })],
        pagination: { nextCursor: null, hasMore: false },
      },
      assert: ({ body }) => {
        // The label filter lives inside `filters`, EMAIL-scoped like the rest.
        // Both values must survive: dropping one silently returns more mail
        // than the AND-of-labels the user asked for.
        expect(body).toMatchObject({
          query: 'invoice',
          filters: { channel: 'EMAIL', labels: ['unread', 'urgent'], includeSpam: true },
        });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'email', 'search', 'invoice',
      '--label', 'unread',
      '--label', 'urgent',
      '--include-spam',
    ]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { items: Array<{ id: string }> };
    expect(parsed.items[0]?.id).toBe(MESSAGE_ID_1);
  });

  test('--label and --include-spam are rejected in --semantic mode and send no request', async () => {
    // WHY: POST /messages/search/semantic takes only query/agentId/limit/threshold,
    // so a label filter would be dropped server-side while the caller is told its
    // search was filtered — the silent no-op this refusal exists to prevent.
    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram([
      'email', 'search', 'invoice',
      '--semantic',
      '--label', 'unread',
      '--include-spam',
    ]);

    process.exit = originalExit;
    console.error = originalError;

    const outputText = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(outputText.includes('--label')).toBe(true);
    expect(outputText.includes('--include-spam')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    expect(requestCount).toBe(0);
  });

  test('--semantic hits /messages/search/semantic with contract defaults (limit 10, threshold 0.7)', async () => {
    setRoute('POST', '/v1/messages/search/semantic', {
      status: 200,
      body: { results: [buildSemanticResult()] },
      assert: ({ body }) => {
        expect(body).toMatchObject({
          query: 'unpaid invoices from vendors',
          limit: 10,
          threshold: 0.7,
        });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'email', 'search', 'unpaid invoices from vendors', '--semantic']);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as {
      results: Array<{ id: string; similarity: number }>;
    };
    expect(parsed.results[0]?.id).toBe(MESSAGE_ID_1);
    expect(parsed.results[0]?.similarity).toBe(0.91);
  });

  test('--semantic forwards agent, custom limit and threshold', async () => {
    setRoute('POST', '/v1/messages/search/semantic', {
      status: 200,
      body: { results: [] },
      assert: ({ body }) => {
        expect(body).toMatchObject({
          query: 'contract renewal',
          agentId: AGENT_ID_1,
          limit: 25,
          threshold: 0.4,
        });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'email', 'search', 'contract renewal',
      '--semantic',
      '--agent', AGENT_ID_1,
      '--limit', '25',
      '--threshold', '0.4',
    ]);

    console.log = originalLog;

    // Response is the structured empty-results payload, not an error.
    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { results: unknown[] };
    expect(parsed.results).toEqual([]);
  });

  test('--threshold without --semantic fails loudly and sends no request', async () => {
    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram(['email', 'search', 'invoice', '--threshold', '0.5']);

    process.exit = originalExit;
    console.error = originalError;

    const outputText = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(outputText.includes('--threshold')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    expect(requestCount).toBe(0);
  });

  test('full-text pagination flags are rejected in --semantic mode and send no request', async () => {
    // WHY: the semantic endpoint has no cursor/direction/status. Silently
    // dropping them would misrepresent what was searched.
    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram([
      'email', 'search', 'invoice',
      '--semantic',
      '--cursor', CURSOR_1,
      '--status', 'delivered',
    ]);

    process.exit = originalExit;
    console.error = originalError;

    const outputText = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(outputText.includes('--status')).toBe(true);
    expect(outputText.includes('--cursor')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    expect(requestCount).toBe(0);
  });

  test('semantic --limit above the contract max (50) is rejected client-side', async () => {
    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram(['email', 'search', 'invoice', '--semantic', '--limit', '51']);

    process.exit = originalExit;
    console.error = originalError;

    const outputText = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(outputText.includes('between 1 and 50')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    expect(requestCount).toBe(0);
  });

  test('semantic 503 is explained as an embedding-provider outage', async () => {
    // WHY (B11): the server distinguishes provider outage (503) from
    // no-results ([]). The CLI must preserve that distinction — an outage
    // rendered as a generic failure (or worse, as "no matches") would make
    // agents conclude the mail doesn't exist.
    setRoute('POST', '/v1/messages/search/semantic', {
      status: 503,
      body: { error: { code: 'UNAVAILABLE', message: 'embedding provider unavailable' } },
    });

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram(['email', 'search', 'invoice', '--semantic']);

    process.exit = originalExit;
    console.error = originalError;

    const outputText = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(outputText.includes('Semantic search is temporarily unavailable')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('search is registered under email', () => {
    const email = program.commands.find((cmd) => cmd.name() === 'email');
    const subcommands = (email?.commands ?? []).map((cmd) => cmd.name());
    expect(subcommands).toContain('search');
  });
});
