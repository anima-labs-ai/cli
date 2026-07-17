/**
 * Intent tests for `anima email draft …` (competitive-parity item C5).
 *
 * Drafts were an MCP-only capability; the CLI had no way to compose an
 * email now and send it later. These tests pin the CLI to the contract's
 * emailDraft router (/email/drafts) and to the one non-obvious semantic:
 * `send` atomically converts the draft into a real Message and DELETES the
 * draft — so its response is a Message, and a later get/send must explain
 * the 404 instead of dead-ending the user.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-email-draft-config');

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
const DRAFT_ID_1 = 'caaa00000000000000000drf01';
const DRAFT_ID_2 = 'caaa00000000000000000drf02';
const AGENT_ID_1 = 'caaa00000000000000000agt01';
const ORG_ID_1 = 'caaa00000000000000000org01';
const IDENTITY_ID_1 = 'caaa00000000000000000idn01';
const MESSAGE_ID_1 = 'caaa00000000000000000msg01';
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

// Build a complete EmailDraftOutput-shaped response. Required because oRPC
// contracts derive the output type from a Zod schema; partial mock
// responses lead to undefined fields when commands access typed fields.
function buildDraftResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DRAFT_ID_1,
    agentId: AGENT_ID_1,
    orgId: ORG_ID_1,
    fromIdentityId: null,
    to: ['a@example.com'],
    cc: [],
    bcc: [],
    subject: 'Quarterly invoice',
    body: 'Hi — invoice attached.',
    bodyHtml: null,
    inReplyTo: null,
    references: [],
    metadata: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Build a complete MessageOutput-shaped response — `draft send` resolves to
// the sent Message, not the draft.
function buildMessageResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MESSAGE_ID_1,
    agentId: AGENT_ID_1,
    channel: 'EMAIL',
    direction: 'OUTBOUND',
    status: 'SENT',
    fromAddress: 'agent@anima.test',
    toAddress: 'a@example.com',
    subject: 'Quarterly invoice',
    body: 'Hi — invoice attached.',
    bodyHtml: null,
    headers: null,
    metadata: null,
    threadId: null,
    inReplyTo: null,
    externalId: null,
    sentAt: '2026-01-01T00:00:00.000Z',
    receivedAt: null,
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('email draft commands', () => {
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

  test('draft create posts the full compose payload to /email/drafts', async () => {
    setRoute('POST', '/v1/email/drafts', {
      status: 200,
      body: buildDraftResponse({
        id: DRAFT_ID_1,
        fromIdentityId: IDENTITY_ID_1,
        to: ['a@example.com', 'b@example.com'],
        cc: ['c@example.com'],
        references: ['ref-1@agents.useanima.sh'],
      }),
      assert: ({ body }) => {
        expect(body).toMatchObject({
          agentId: AGENT_ID_1,
          fromIdentityId: IDENTITY_ID_1,
          to: ['a@example.com', 'b@example.com'],
          cc: ['c@example.com'],
          subject: 'Hello',
          body: 'Body',
          bodyHtml: '<p>Body</p>',
          inReplyTo: 'parent@agents.useanima.sh',
          references: ['ref-1@agents.useanima.sh'],
        });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'email', 'draft', 'create',
      '--agent', AGENT_ID_1,
      '--from-identity', IDENTITY_ID_1,
      '--to', 'a@example.com',
      '--to', 'b@example.com',
      '--cc', 'c@example.com',
      '--subject', 'Hello',
      '--body', 'Body',
      '--html', '<p>Body</p>',
      '--in-reply-to', 'parent@agents.useanima.sh',
      '--reference', 'ref-1@agents.useanima.sh',
    ]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string };
    expect(parsed.id).toBe(DRAFT_ID_1);
  });

  test('draft create allows an incomplete draft — only --agent is required', async () => {
    // WHY: a draft is compose-in-progress. Requiring recipients/subject at
    // create time (like `email send` does) would defeat the feature.
    setRoute('POST', '/v1/email/drafts', {
      status: 200,
      body: buildDraftResponse({ to: [], subject: null, body: null }),
      assert: ({ body }) => {
        expect(body).toMatchObject({ agentId: AGENT_ID_1, to: [] });
        const payload = body as Record<string, unknown>;
        expect(payload.subject).toBeUndefined();
        expect(payload.body).toBeUndefined();
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'email', 'draft', 'create', '--agent', AGENT_ID_1]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string; subject: string | null };
    expect(parsed.id).toBe(DRAFT_ID_1);
    expect(parsed.subject).toBeNull();
  });

  test('draft get fetches by id', async () => {
    setRoute('GET', `/v1/email/drafts/${DRAFT_ID_2}`, {
      status: 200,
      body: buildDraftResponse({ id: DRAFT_ID_2, subject: 'Subj' }),
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'email', 'draft', 'get', DRAFT_ID_2]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string; subject: string };
    expect(parsed.id).toBe(DRAFT_ID_2);
    expect(parsed.subject).toBe('Subj');
  });

  test('draft list sends pagination and agent filter', async () => {
    setRoute('GET', '/v1/email/drafts', {
      status: 200,
      body: {
        items: [buildDraftResponse({ id: DRAFT_ID_1 })],
        pagination: { nextCursor: CURSOR_2, hasMore: true },
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('cursor')).toBe(CURSOR_1);
        expect(url.searchParams.get('limit')).toBe('10');
        expect(url.searchParams.get('agentId')).toBe(AGENT_ID_1);
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'email', 'draft', 'list',
      '--cursor', CURSOR_1,
      '--limit', '10',
      '--agent', AGENT_ID_1,
    ]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as {
      items: Array<{ id: string }>;
      pagination: { nextCursor: string };
    };
    expect(parsed.items[0]?.id).toBe(DRAFT_ID_1);
    expect(parsed.pagination.nextCursor).toBe(CURSOR_2);
  });

  test('draft send posts to /email/drafts/{id}/send and resolves to the sent Message', async () => {
    // WHY: send converts the draft into a Message (email.send semantics)
    // and deletes the draft — the CLI must surface the MESSAGE id, which is
    // what the user needs next (email get, threading), not the dead draft id.
    setRoute('POST', `/v1/email/drafts/${DRAFT_ID_1}/send`, {
      status: 200,
      body: buildMessageResponse({ id: MESSAGE_ID_1, status: 'QUEUED' }),
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'email', 'draft', 'send', DRAFT_ID_1]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string; channel: string };
    expect(parsed.id).toBe(MESSAGE_ID_1);
    expect(parsed.channel).toBe('EMAIL');
  });

  test('draft send success message names the new message id', async () => {
    setRoute('POST', `/v1/email/drafts/${DRAFT_ID_1}/send`, {
      status: 200,
      body: buildMessageResponse({ id: MESSAGE_ID_1, status: 'QUEUED' }),
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['email', 'draft', 'send', DRAFT_ID_1]);

    console.log = originalLog;

    const outputText = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(outputText.includes(MESSAGE_ID_1)).toBe(true);
  });

  test('draft delete calls DELETE /email/drafts/{id}', async () => {
    setRoute('DELETE', `/v1/email/drafts/${DRAFT_ID_2}`, {
      status: 200,
      body: buildDraftResponse({ id: DRAFT_ID_2 }),
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['email', 'draft', 'delete', DRAFT_ID_2]);

    console.log = originalLog;

    const outputText = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(outputText.includes(`Deleted draft ${DRAFT_ID_2}`)).toBe(true);
  });

  test('draft get 404 explains send-deletes-the-draft semantics', async () => {
    // WHY: after a successful `draft send`, the draft id 404s by design.
    // A bare "not found" reads like data loss; the error must explain it.
    setRoute('GET', `/v1/email/drafts/${DRAFT_ID_1}`, {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'draft not found' } },
    });

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram(['email', 'draft', 'get', DRAFT_ID_1]);

    process.exit = originalExit;
    console.error = originalError;

    const outputText = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(outputText.includes('sent (send deletes the draft) or deleted')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('draft send surfaces server validation errors (incomplete draft)', async () => {
    // WHY: drafts may be incomplete; the server rejects sending one with
    // no recipients. That message must reach the user verbatim.
    setRoute('POST', `/v1/email/drafts/${DRAFT_ID_1}/send`, {
      status: 400,
      body: { error: { code: 'BAD_REQUEST', message: 'Draft has no recipients' } },
    });

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram(['email', 'draft', 'send', DRAFT_ID_1]);

    process.exit = originalExit;
    console.error = originalError;

    const outputText = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(outputText.includes('Failed to send draft: Draft has no recipients')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('draft subcommands are registered under email', () => {
    const email = program.commands.find((cmd) => cmd.name() === 'email');
    const draft = email?.commands.find((cmd) => cmd.name() === 'draft');
    expect(draft).toBeDefined();
    const subcommands = (draft?.commands ?? []).map((cmd) => cmd.name());
    expect(subcommands).toContain('create');
    expect(subcommands).toContain('get');
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('send');
    expect(subcommands).toContain('delete');
  });
});
