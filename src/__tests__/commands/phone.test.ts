import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-phone-config');

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
const AGENT_ID_2 = 'caaa00000000000000000agt02';
const AGENT_ID_9 = 'caaa00000000000000000agt09';
const PHONE_ID_1 = 'caaa00000000000000000phn01';
const PHONE_ID_2 = 'caaa00000000000000000phn02';
const MESSAGE_ID_1 = 'caaa00000000000000000msg01';

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

function setAuthenticatedConfig(port: number): void {
  const authPath = join(testConfigDir, 'auth.json');
  writeFileSync(authPath, JSON.stringify({
    token: 'test-token',
    apiUrl: `http://localhost:${port}`,
  }));
}

async function runProgram(args: string[]): Promise<void> {
  try {
    await program.parseAsync(['node', 'anima', ...args]);
  } catch {
  }
}

// Build a complete PhoneIdentityOutput-shaped response. Required because
// oRPC contracts derive the output type from a Zod schema; partial mock
// responses lead to undefined fields when commands access typed fields.
function buildPhoneIdentityResponse(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: PHONE_ID_1,
    phoneNumber: '+14155550124',
    provider: 'TELNYX',
    providerId: 'tnyx_abc',
    capabilities: { sms: true, mms: false, voice: false },
    tenDlcStatus: 'NOT_REQUIRED',
    isPrimary: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Build a complete PhoneProvisionOutput-shaped response.
function buildProvisionResponse(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: PHONE_ID_1,
    phoneNumber: '+14155550124',
    provider: 'TELNYX',
    providerId: 'tnyx_abc',
    capabilities: { sms: true, mms: false, voice: false },
    tenDlcStatus: 'NOT_REQUIRED',
    isPrimary: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Build a complete MessageOutput-shaped response (returned by phone.sendSms).
function buildMessageResponse(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: MESSAGE_ID_1,
    agentId: AGENT_ID_9,
    channel: 'SMS',
    direction: 'OUTBOUND',
    status: 'QUEUED',
    fromAddress: '+14155550124',
    toAddress: '+14155550199',
    subject: null,
    body: 'Hello from CLI',
    bodyHtml: null,
    headers: null,
    metadata: null,
    threadId: null,
    inReplyTo: null,
    externalId: null,
    sentAt: null,
    receivedAt: null,
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('phone commands', () => {
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
          return new Response(
            JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not Found' } }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
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

        return new Response(
          route.status === 204 ? null : JSON.stringify(route.body),
          { status: route.status, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });
    mockServer = server;
    serverPort = server.port ?? 0;
  });

  afterEach(() => {
    mockServer?.stop();
    mockServer = null;
    clearRoutes();
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  test('phone search sends expected query params and renders table', async () => {
    setAuthenticatedConfig(serverPort);

    setRoute('GET', '/v1/phone/search', {
      status: 200,
      body: {
        items: [
          {
            phoneNumber: '+14155550123',
            region: 'CA',
            capabilities: { sms: true, mms: false, voice: true },
            monthlyCost: 1.0,
          },
        ],
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('countryCode')).toBe('US');
        expect(url.searchParams.get('areaCode')).toBe('415');
        expect(url.searchParams.get('limit')).toBe('10');
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await runProgram([
        'phone', 'search',
        '--country', 'US',
        '--area-code', '415',
        '--capabilities', 'sms,voice',
        '--limit', '10',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('phone search supports json mode output', async () => {
    setAuthenticatedConfig(serverPort);

    setRoute('GET', '/v1/phone/search', {
      status: 200,
      body: {
        items: [
          {
            phoneNumber: '+14155550123',
            region: 'CA',
            capabilities: { sms: true, mms: false, voice: true },
            monthlyCost: 1.0,
          },
        ],
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await runProgram(['--json', 'phone', 'search']);
    } finally {
      console.log = originalLog;
    }

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
    const firstLogCall = logSpy.mock.calls.at(0) as unknown[] | undefined;
    const payload = String(firstLogCall?.[0] ?? '');
    expect(payload).toContain('items');
    expect(payload).toContain('+14155550123');
  });

  test('phone provision sends required payload', async () => {
    setAuthenticatedConfig(serverPort);

    setRoute('POST', '/v1/phone/provision', {
      status: 200,
      body: buildProvisionResponse(),
      assert: ({ body }) => {
        expect(body).toMatchObject({
          agentId: AGENT_ID_1,
          countryCode: 'US',
          areaCode: '415',
        });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await runProgram([
        'phone', 'provision',
        '--agent', AGENT_ID_1,
        '--country', 'US',
        '--area-code', '415',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('phone list sends agent query param', async () => {
    setAuthenticatedConfig(serverPort);

    setRoute('GET', '/v1/phone/numbers', {
      status: 200,
      body: {
        items: [
          buildPhoneIdentityResponse({
            id: PHONE_ID_1,
            phoneNumber: '+14155550124',
            capabilities: { sms: true, mms: false, voice: false },
          }),
          buildPhoneIdentityResponse({
            id: PHONE_ID_2,
            phoneNumber: '+14155550125',
            capabilities: { sms: false, mms: false, voice: true },
            isPrimary: false,
          }),
        ],
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('agentId')).toBe(AGENT_ID_2);
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await runProgram(['phone', 'list', '--agent', AGENT_ID_2]);
    } finally {
      console.log = originalLog;
    }

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('phone release sends required payload', async () => {
    setAuthenticatedConfig(serverPort);

    setRoute('POST', '/v1/phone/release', {
      status: 200,
      body: { success: true },
      assert: ({ body }) => {
        expect(body).toMatchObject({
          agentId: AGENT_ID_1,
          phoneNumber: '+14155550124',
        });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await runProgram([
        'phone', 'release',
        '--agent', AGENT_ID_1,
        '--number', '+14155550124',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('phone send-sms sends required payload with media urls', async () => {
    setAuthenticatedConfig(serverPort);

    setRoute('POST', '/v1/phone/send-sms', {
      status: 200,
      body: buildMessageResponse({
        agentId: AGENT_ID_9,
        toAddress: '+14155550199',
        body: 'Hello from CLI',
      }),
      assert: ({ body }) => {
        expect(body).toMatchObject({
          agentId: AGENT_ID_9,
          to: '+14155550199',
          body: 'Hello from CLI',
          mediaUrls: ['https://example.com/a.png', 'https://example.com/b.png'],
        });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await runProgram([
        'phone', 'send-sms',
        '--agent', AGENT_ID_9,
        '--to', '+14155550199',
        '--body', 'Hello from CLI',
        '--media-url', 'https://example.com/a.png',
        '--media-url', 'https://example.com/b.png',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('phone search handles ApiError with user-friendly message', async () => {
    setAuthenticatedConfig(serverPort);

    setRoute('GET', '/v1/phone/search', {
      status: 503,
      body: {
        error: {
          code: 'PHONE_ERROR',
          message: 'Phone service down',
        },
      },
    });

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await runProgram(['phone', 'search']);
    } catch {
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }

    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    const firstErrorCall = errorSpy.mock.calls.at(0) as unknown[] | undefined;
    const message = String(firstErrorCall?.[0] ?? '');
    expect(message).toContain('Failed to search phone numbers: Phone service down');
  });

  test('phone send-sms validates body length', async () => {
    setAuthenticatedConfig(serverPort);

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await runProgram([
        'phone', 'send-sms',
        '--agent', AGENT_ID_1,
        '--to', '+14155550199',
        '--body', '',
      ]);
    } catch {
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }

    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    const firstErrorCall = errorSpy.mock.calls.at(0) as unknown[] | undefined;
    const message = String(firstErrorCall?.[0] ?? '');
    expect(message).toContain('Invalid --body');
  });

  test('phone list fails when not authenticated', async () => {
    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await runProgram(['phone', 'list', '--agent', AGENT_ID_2]);
    } catch {
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }

    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('phone search handles 429 rate limiting', async () => {
    setAuthenticatedConfig(serverPort);

    setRoute('GET', '/v1/phone/search', {
      status: 429,
      body: {
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      },
    });

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await runProgram(['phone', 'search']);
    } catch {
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }

    const firstErrorCall = errorSpy.mock.calls.at(0) as unknown[] | undefined;
    const message = String(firstErrorCall?.[0] ?? '');
    expect(message).toContain('Failed to search phone numbers: Too many requests');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('phone list handles 500 server error', async () => {
    setAuthenticatedConfig(serverPort);

    setRoute('GET', '/v1/phone/numbers', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'Unexpected failure' } },
    });

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await runProgram(['phone', 'list', '--agent', AGENT_ID_2]);
    } catch {
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }

    const firstErrorCall = errorSpy.mock.calls.at(0) as unknown[] | undefined;
    const message = String(firstErrorCall?.[0] ?? '');
    expect(message).toContain('Failed to list phone numbers: Unexpected failure');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
