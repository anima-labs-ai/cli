import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-email-config');

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
const EMAIL_ID_1 = 'caaa00000000000000000eml01';
const EMAIL_ID_777 = 'caaa00000000000000000eml77';
const AGENT_ID_1 = 'caaa00000000000000000agt01';
const AGENT_ID_9 = 'caaa00000000000000000agt09';
const DOMAIN_ID_1 = 'caaa00000000000000000dom01';
const DOMAIN_ID_2 = 'caaa00000000000000000dom02';
const DOMAIN_ID_3 = 'caaa00000000000000000dom03';
const DOMAIN_ID_4 = 'caaa00000000000000000dom04';
const DOMAIN_ID_5 = 'caaa00000000000000000dom05';
const DOMAIN_ID_42 = 'caaa00000000000000000dom42';
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

// Build a complete MessageOutput-shaped response. Required because oRPC
// contracts derive the output type from a Zod schema; partial mock
// responses lead to undefined fields when commands access typed fields.
function buildMessageResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EMAIL_ID_1,
    agentId: AGENT_ID_1,
    channel: 'EMAIL',
    direction: 'OUTBOUND',
    status: 'SENT',
    fromAddress: 'agent@anima.test',
    toAddress: 'a@example.com',
    subject: 'Welcome',
    body: 'Body',
    bodyHtml: null,
    headers: null,
    metadata: null,
    threadId: null,
    labels: ['unread'],
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

// Build a complete DomainOutput-shaped response.
function buildDomainResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DOMAIN_ID_1,
    domain: 'example.com',
    status: 'PENDING',
    verified: false,
    verificationCooldownUntil: null,
    verificationToken: 'tok_abc',
    verificationMethod: 'DNS_TXT',
    dkimSelector: null,
    dkimPublicKey: null,
    spfConfigured: false,
    dmarcConfigured: false,
    mxConfigured: false,
    feedbackEnabled: false,
    records: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Read an array query key regardless of which equivalent wire-form oRPC's
 * OpenAPILink emits — it serializes arrays with indexed brackets
 * (`?labels[0]=a&labels[1]=b`); plain and bare-bracket are the same array to
 * the server. Pins the VALUES on the wire, not the encoding oRPC chose.
 */
function collectQueryValues(url: URL, key: string): string[] {
  const values: string[] = [];
  const indexed = new RegExp(`^${key}(\\[\\d*\\])?$`);
  for (const [name, value] of url.searchParams.entries()) {
    if (indexed.test(name)) values.push(value);
  }
  return values;
}

describe('email commands', () => {
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

  test('email send sends expected payload', async () => {
    setRoute('POST', '/v1/email/send', {
      status: 200,
      body: buildMessageResponse({ id: EMAIL_ID_1, status: 'QUEUED' }),
      assert: ({ body }) => {
        expect(body).toMatchObject({
          agentId: AGENT_ID_1,
          to: ['a@example.com', 'b@example.com'],
          cc: ['c@example.com'],
          bcc: ['d@example.com'],
          subject: 'Hello',
          body: 'Body',
          bodyHtml: '<p>Body</p>',
        });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'email',
      'send',
      '--agent', AGENT_ID_1,
      '--to', 'a@example.com',
      '--to', 'b@example.com',
      '--cc', 'c@example.com',
      '--bcc', 'd@example.com',
      '--subject', 'Hello',
      '--body', 'Body',
      '--html', '<p>Body</p>',
    ]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string };
    expect(parsed.id).toBe(EMAIL_ID_1);
  });

  test('email list sends pagination and agent query', async () => {
    setRoute('GET', '/v1/email', {
      status: 200,
      body: {
        items: [buildMessageResponse({ id: EMAIL_ID_1, subject: 'Welcome' })],
        pagination: {
          nextCursor: CURSOR_2,
          hasMore: true,
        },
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('cursor')).toBe(CURSOR_1);
        expect(url.searchParams.get('limit')).toBe('10');
        expect(url.searchParams.get('agentId')).toBe(AGENT_ID_1);
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'email',
      'list',
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
    expect(parsed.items[0]?.id).toBe(EMAIL_ID_1);
    expect(parsed.pagination.nextCursor).toBe(CURSOR_2);
  });

  test('email list forwards repeated --label and --include-spam as query params', async () => {
    let seen: URL | null = null;
    setRoute('GET', '/v1/email', {
      status: 200,
      body: {
        items: [buildMessageResponse({ id: EMAIL_ID_1, labels: ['unread', 'urgent'] })],
        pagination: { nextCursor: null, hasMore: false },
      },
      assert: ({ url }) => {
        seen = url;
      },
    });

    await runProgram([
      '--json',
      'email', 'list',
      '--label', 'unread',
      '--label', 'urgent',
      '--include-spam',
    ]);

    expect(seen).not.toBeNull();
    // Both labels must reach the wire (AND semantics). oRPC serializes arrays
    // with indexed brackets (`labels[0]=`), so collect across that form.
    const labelValues = collectQueryValues(seen!, 'labels');
    expect(labelValues.sort()).toEqual(['unread', 'urgent']);
    expect(seen!.search.includes('includeSpam=true')).toBe(true);
  });

  test('email get fetches by id', async () => {
    setRoute('GET', `/v1/email/${EMAIL_ID_777}`, {
      status: 200,
      body: buildMessageResponse({ id: EMAIL_ID_777, agentId: AGENT_ID_9, subject: 'Subj' }),
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'email', 'get', EMAIL_ID_777]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string; agentId: string };
    expect(parsed.id).toBe(EMAIL_ID_777);
    expect(parsed.agentId).toBe(AGENT_ID_9);
  });

  test('email domains add lowercases domain', async () => {
    setRoute('POST', '/v1/domains', {
      status: 200,
      body: buildDomainResponse({ id: DOMAIN_ID_1, domain: 'example.com' }),
      assert: ({ body }) => {
        expect(body).toEqual({ domain: 'example.com' });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'email', 'domains', 'add', 'Example.COM']);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string; domain: string };
    expect(parsed.id).toBe(DOMAIN_ID_1);
    expect(parsed.domain).toBe('example.com');
  });

  test('email domains verify posts to verify endpoint', async () => {
    setRoute('POST', `/v1/domains/${DOMAIN_ID_42}/verify`, {
      status: 200,
      body: buildDomainResponse({ id: DOMAIN_ID_42, verified: true, status: 'VERIFIED' }),
      assert: ({ body }) => {
        // oRPC OpenAPILink lifts the contract's path param `{id}` into the
        // URL (POST /domains/<id>/verify) and only the additional `domainId`
        // field from VerifyDomainInput remains in the body.
        expect(body).toMatchObject({ domainId: DOMAIN_ID_42 });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'email', 'domains', 'verify', DOMAIN_ID_42]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string; verified: boolean };
    expect(parsed.id).toBe(DOMAIN_ID_42);
    expect(parsed.verified).toBe(true);
  });

  test('email domains list calls list endpoint', async () => {
    setRoute('GET', '/v1/domains', {
      status: 200,
      body: {
        items: [buildDomainResponse({ id: DOMAIN_ID_1, domain: 'example.com' })],
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'email', 'domains', 'list']);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { items: Array<{ id: string }> };
    expect(parsed.items[0]?.id).toBe(DOMAIN_ID_1);
  });

  test('email domains get fetches details by id', async () => {
    setRoute('GET', `/v1/domains/${DOMAIN_ID_2}`, {
      status: 200,
      body: buildDomainResponse({ id: DOMAIN_ID_2, domain: 'foo.com' }),
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'email', 'domains', 'get', DOMAIN_ID_2]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { id: string; domain: string };
    expect(parsed.id).toBe(DOMAIN_ID_2);
    expect(parsed.domain).toBe('foo.com');
  });

  test('email domains delete calls delete endpoint', async () => {
    setRoute('DELETE', `/v1/domains/${DOMAIN_ID_3}`, {
      status: 200,
      body: { success: true },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['email', 'domains', 'delete', DOMAIN_ID_3]);

    console.log = originalLog;

    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes(`Deleted domain ${DOMAIN_ID_3}`)).toBe(true);
  });

  test('email domains dns fetches dns records', async () => {
    setRoute('GET', `/v1/domains/${DOMAIN_ID_4}/dns-records`, {
      status: 200,
      body: {
        txt: { name: '_anima-verify.example.com', value: 'anima-verify=tok_abc' },
        mailFrom: {
          name: 'mail.example.com',
          mx: { value: 'feedback-smtp.example.com', priority: 10 },
          spf: 'v=spf1 include:amazonses.com ~all',
        },
        dkim: [
          { name: 'sel1._domainkey.example.com', value: 'sel1.dkim.amazonses.com' },
        ],
        mx: { name: 'example.com', value: 'inbound-smtp.example.com', priority: 10 },
        spf: 'v=spf1 include:amazonses.com ~all',
        dmarc: 'v=DMARC1; p=none;',
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'email', 'domains', 'dns', DOMAIN_ID_4]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as {
      txt: { name: string };
      dkim: Array<{ name: string }>;
    };
    expect(parsed.txt.name).toBe('_anima-verify.example.com');
    expect(parsed.dkim[0]?.name).toBe('sel1._domainkey.example.com');
  });

  test('email domains deliverability fetches metrics', async () => {
    setRoute('GET', `/v1/domains/${DOMAIN_ID_5}/deliverability`, {
      status: 200,
      body: {
        domain: 'example.com',
        sent: 100,
        delivered: 95,
        bounced: 4,
        complained: 1,
        bounceRate: 0.04,
        complaintRate: 0.01,
        isHealthy: true,
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'email', 'domains', 'deliverability', DOMAIN_ID_5]);

    console.log = originalLog;

    const printed = logSpy.mock.calls.at(0)?.at(0);
    const parsed = JSON.parse(String(printed)) as { sent: number; isHealthy: boolean };
    expect(parsed.sent).toBe(100);
    expect(parsed.isHealthy).toBe(true);
  });

  test('email send handles api errors with friendly message', async () => {
    setRoute('POST', '/v1/email/send', {
      status: 400,
      body: {
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid recipient',
        },
      },
    });

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram([
      'email',
      'send',
      '--agent', AGENT_ID_1,
      '--to', 'a@example.com',
      '--subject', 'S',
      '--body', 'B',
    ]);

    process.exit = originalExit;
    console.error = originalError;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to send email: Invalid recipient')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('email send handles 429 rate limiting', async () => {
    setRoute('POST', '/v1/email/send', {
      status: 429,
      body: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
        },
      },
    });

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram([
      'email',
      'send',
      '--agent', AGENT_ID_1,
      '--to', 'a@example.com',
      '--subject', 'S',
      '--body', 'B',
    ]);

    process.exit = originalExit;
    console.error = originalError;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to send email: Too many requests')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('email list handles 503 server unavailable', async () => {
    setRoute('GET', '/v1/email', {
      status: 503,
      body: {
        error: {
          code: 'UNAVAILABLE',
          message: 'Service unavailable',
        },
      },
    });

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram(['email', 'list']);

    process.exit = originalExit;
    console.error = originalError;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to list emails: Service unavailable')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('email get handles 404 with friendly message', async () => {
    setRoute('GET', `/v1/email/${EMAIL_ID_1}`, {
      status: 404,
      body: {
        error: { code: 'NOT_FOUND', message: 'email not found' },
      },
    });

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runProgram(['email', 'get', EMAIL_ID_1]);

    process.exit = originalExit;
    console.error = originalError;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Email not found.')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('email commands are registered in help output', () => {
    const email = program.commands.find((cmd) => cmd.name() === 'email');
    expect(email).toBeDefined();
    const subcommands = (email?.commands ?? []).map((cmd) => cmd.name());
    expect(subcommands).toContain('send');
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('get');
    expect(subcommands).toContain('domains');
  });
});
