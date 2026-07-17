import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-message-config');

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

// Real-looking CUIDs so the contract's z.string().cuid() input validation in
// the typed oRPC client doesn't reject the test args before the request ever
// reaches the mock server.
const MSG_ID_1 = 'caaa00000000000000000msg01';
const AGENT_ID_1 = 'caaa00000000000000000agt01';

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

// A complete MessageOutput-shaped response; the typed oRPC client derives the
// output type from a Zod schema, so a partial mock surfaces as undefined
// fields when a command reads them. `labels` is part of that shape now.
function buildMessageResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MSG_ID_1,
    agentId: AGENT_ID_1,
    channel: 'EMAIL',
    direction: 'INBOUND',
    status: 'DELIVERED',
    fromAddress: 'someone@example.com',
    toAddress: 'agent@anima.test',
    subject: 'Invoice',
    body: 'Body',
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

describe('message commands', () => {
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
    clearRoutes();
    mockServer?.stop(true);
    mockServer = null;
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  test('message label lifts the id into the path and sends add/remove arrays', async () => {
    let seen: { url: URL; body: unknown } | null = null;
    setRoute('PATCH', `/v1/messages/${MSG_ID_1}/labels`, {
      status: 200,
      body: buildMessageResponse({ id: MSG_ID_1, labels: ['read', 'urgent'] }),
      assert: (ctx) => {
        seen = ctx;
      },
    });

    await runProgram([
      '--json',
      'message',
      'label',
      MSG_ID_1,
      '--add', 'read',
      '--add', 'urgent',
      '--remove', 'unread',
    ]);

    expect(seen).not.toBeNull();
    // `id` rides in the URL path, never the body — the whole point of a
    // per-id PATCH. Only the add/remove arrays remain in the payload.
    expect(seen!.body).toEqual({ addLabels: ['read', 'urgent'], removeLabels: ['unread'] });
  });

  test('message label sends only addLabels when nothing to remove', async () => {
    let seen: { body: unknown } | null = null;
    setRoute('PATCH', `/v1/messages/${MSG_ID_1}/labels`, {
      status: 200,
      body: buildMessageResponse({ id: MSG_ID_1, labels: ['read'] }),
      assert: (ctx) => {
        seen = ctx;
      },
    });

    await runProgram(['--json', 'message', 'label', MSG_ID_1, '--add', 'read']);

    expect(seen).not.toBeNull();
    // removeLabels omitted entirely (undefined), not sent as an empty array —
    // an empty array is a distinct instruction the server need not process.
    expect(seen!.body).toEqual({ addLabels: ['read'] });
  });

  test('message label refuses when neither --add nor --remove is given', async () => {
    let requestMade = false;
    setRoute('PATCH', `/v1/messages/${MSG_ID_1}/labels`, {
      status: 200,
      body: buildMessageResponse(),
      assert: () => {
        requestMade = true;
      },
    });

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;
    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram(['message', 'label', MSG_ID_1]);

    process.exit = originalExit;
    console.error = originalError;

    // A no-op relabel never reaches the wire — it is a usage mistake, caught
    // before the request and reported with a non-zero exit.
    expect(requestMade).toBe(false);
    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Supply at least one of --add or --remove')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('message list forwards repeated --label and --include-spam as query params', async () => {
    let seen: URL | null = null;
    setRoute('GET', '/v1/messages', {
      status: 200,
      body: {
        items: [buildMessageResponse({ labels: ['unread', 'urgent'] })],
        pagination: { nextCursor: null, hasMore: false },
      },
      assert: ({ url }) => {
        seen = url;
      },
    });

    await runProgram([
      '--json',
      'message',
      'list',
      '--label', 'unread',
      '--label', 'urgent',
      '--include-spam',
    ]);

    expect(seen).not.toBeNull();
    // Both labels must survive on the wire: dropping one silently WIDENS the
    // result ("unread AND urgent" degrading to just "unread" returns more mail
    // than asked for), so assert the multi-value form the server reads as AND.
    const labelValues = collectQueryValues(seen!, 'labels');
    expect(labelValues.sort()).toEqual(['unread', 'urgent']);
    expect(seen!.search.includes('includeSpam=true')).toBe(true);
  });

  test('message search puts labels and includeSpam inside filters', async () => {
    let seen: { body: unknown } | null = null;
    setRoute('POST', '/v1/messages/search', {
      status: 200,
      body: {
        items: [buildMessageResponse({ labels: ['unread'] })],
        pagination: { nextCursor: null, hasMore: false },
      },
      assert: (ctx) => {
        seen = ctx;
      },
    });

    await runProgram([
      '--json',
      'message',
      'search',
      'invoice',
      '--label', 'unread',
      '--include-spam',
    ]);

    expect(seen).not.toBeNull();
    expect(seen!.body).toMatchObject({
      query: 'invoice',
      filters: { labels: ['unread'], includeSpam: true },
    });
  });
});

/**
 * Read an array query key regardless of which equivalent wire-form the oRPC
 * OpenAPILink emits. It serializes arrays with indexed brackets
 * (`?labels[0]=a&labels[1]=b`), but plain (`labels=a&labels=b`) and bare-bracket
 * (`labels[]=a`) are the same array to the server's deserializer. The test
 * pins the VALUES that reach the wire, not the encoding oRPC happens to choose.
 */
function collectQueryValues(url: URL, key: string): string[] {
  const values: string[] = [];
  const indexed = new RegExp(`^${key}(\\[\\d*\\])?$`);
  for (const [name, value] of url.searchParams.entries()) {
    if (indexed.test(name)) values.push(value);
  }
  return values;
}
