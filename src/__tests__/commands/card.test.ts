import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-card-config');

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
const CARD_ID_1 = 'caaa00000000000000000crd01';
const AGENT_ID_1 = 'caaa00000000000000000agt01';
const ORG_ID_1 = 'caaa00000000000000000org01';
const TXN_ID_1 = 'caaa00000000000000000txn01';

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

// Build a complete CardOutput-shaped response. Required because oRPC
// contracts derive the output type from a Zod schema; partial mock
// responses lead to undefined fields when commands access typed fields
// like `card.allowedMerchantCategories`.
function buildCardResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CARD_ID_1,
    agentId: AGENT_ID_1,
    orgId: ORG_ID_1,
    providerCardId: 'card_xxx',
    providerCardholderId: 'ch_xxx',
    cardType: 'VIRTUAL',
    status: 'ACTIVE',
    last4: '4242',
    brand: 'Visa',
    expMonth: 12,
    expYear: 2030,
    currency: 'usd',
    label: 'Primary',
    spendLimitDaily: 5000,
    spendLimitMonthly: 15000,
    spendLimitPerAuth: 3000,
    spendLimitWeekly: null,
    spendLimitYearly: null,
    spendLimitLifetime: null,
    allowedMerchantCategories: [],
    blockedMerchantCategories: [],
    spentToday: 0,
    spentThisMonth: 0,
    spentThisWeek: 0,
    spentThisYear: 0,
    spentLifetime: 0,
    killSwitchActive: false,
    metadata: {},
    createdAt: '2026-03-19T00:00:00.000Z',
    updatedAt: '2026-03-19T00:00:00.000Z',
    canceledAt: null,
    ...overrides,
  };
}

function buildTransactionResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TXN_ID_1,
    cardId: CARD_ID_1,
    orgId: ORG_ID_1,
    providerAuthId: 'iauth_xxx',
    providerTransactionId: null,
    status: 'PENDING',
    decision: null,
    amountCents: 1234,
    currency: 'usd',
    merchantName: 'Coffee Shop',
    merchantCategory: null,
    merchantCategoryCode: null,
    merchantCity: null,
    merchantCountry: null,
    declineReason: null,
    policyId: null,
    approvedBy: null,
    approvedAt: null,
    metadata: {},
    createdAt: '2026-03-19T02:00:00.000Z',
    updatedAt: '2026-03-19T02:00:00.000Z',
    ...overrides,
  };
}

describe('card commands', () => {
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

  test('card create sends expected payload', async () => {
    setRoute('POST', '/v1/cards', {
      status: 200,
      body: buildCardResponse({ label: 'Primary' }),
      assert: ({ body }) => {
        expect(body).toMatchObject({
          agentId: AGENT_ID_1,
          label: 'Primary',
          currency: 'usd',
          spendLimitDaily: 5000,
          spendLimitMonthly: 15000,
          spendLimitPerAuth: 3000,
        });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      'card', 'create',
      '--agent', AGENT_ID_1,
      '--label', 'Primary',
      '--daily-limit', '5000',
      '--monthly-limit', '15000',
      '--per-auth-limit', '3000',
    ]);

    console.log = originalLog;

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card list sends expected query', async () => {
    setRoute('GET', '/v1/cards', {
      status: 200,
      body: {
        items: [buildCardResponse()],
        cursor: undefined,
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('agentId')).toBe(AGENT_ID_1);
        expect(url.searchParams.get('status')).toBe('ACTIVE');
        expect(url.searchParams.get('limit')).toBe('25');
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      'card', 'list',
      '--agent', AGENT_ID_1,
      '--status', 'ACTIVE',
      '--limit', '25',
    ]);

    console.log = originalLog;

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card get supports json output', async () => {
    setRoute('GET', `/v1/cards/${CARD_ID_1}`, {
      status: 200,
      body: buildCardResponse(),
    });

    const logSpy = mock((..._args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'card', 'get', CARD_ID_1]);

    console.log = originalLog;

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
    const firstArg = logSpy.mock.calls[0]?.[0];
    expect(typeof firstArg).toBe('string');
    if (typeof firstArg === 'string') {
      const parsed = JSON.parse(firstArg) as { id: string; agentId: string };
      expect(parsed.id).toBe(CARD_ID_1);
      expect(parsed.agentId).toBe(AGENT_ID_1);
    }
  });

  test('card update sends expected payload', async () => {
    setRoute('PUT', `/v1/cards/${CARD_ID_1}`, {
      status: 200,
      body: buildCardResponse({
        label: 'Updated',
        status: 'FROZEN',
        spendLimitDaily: 7000,
        spendLimitMonthly: 20000,
        spendLimitPerAuth: 2500,
        updatedAt: '2026-03-19T01:00:00.000Z',
      }),
      assert: ({ body }) => {
        // oRPC OpenAPILink lifts the contract's path param `{cardId}` into
        // the URL (PUT /cards/<cardId>) and omits it from the request body.
        expect(body).toMatchObject({
          label: 'Updated',
          status: 'FROZEN',
          spendLimitDaily: 7000,
          spendLimitMonthly: 20000,
          spendLimitPerAuth: 2500,
        });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      'card', 'update', CARD_ID_1,
      '--label', 'Updated',
      '--status', 'FROZEN',
      '--daily-limit', '7000',
      '--monthly-limit', '20000',
      '--per-auth-limit', '2500',
    ]);

    console.log = originalLog;

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card delete hits delete endpoint', async () => {
    setRoute('DELETE', `/v1/cards/${CARD_ID_1}`, {
      status: 200,
      body: { success: true },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['card', 'delete', CARD_ID_1]);

    console.log = originalLog;

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card transactions sends expected query', async () => {
    setRoute('GET', '/v1/cards/transactions', {
      status: 200,
      body: {
        items: [buildTransactionResponse()],
        cursor: undefined,
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('cardId')).toBe(CARD_ID_1);
        expect(url.searchParams.get('agentId')).toBe(AGENT_ID_1);
        expect(url.searchParams.get('status')).toBe('PENDING');
        expect(url.searchParams.get('limit')).toBe('10');
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      'card', 'transactions',
      '--card', CARD_ID_1,
      '--agent', AGENT_ID_1,
      '--status', 'PENDING',
      '--limit', '10',
    ]);

    console.log = originalLog;

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card kill-switch sends expected payload', async () => {
    setRoute('POST', '/v1/cards/kill-switch', {
      status: 200,
      body: {
        affected: 1,
        active: true,
      },
      assert: ({ body }) => {
        expect(body).toMatchObject({
          active: true,
          cardId: CARD_ID_1,
        });
      },
    });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['card', 'kill-switch', '--active', '--card', CARD_ID_1]);

    console.log = originalLog;

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card commands handle ORPCError responses', async () => {
    setRoute('GET', '/v1/cards', {
      status: 400,
      body: { error: { code: 'BAD_REQUEST', message: 'invalid card request' } },
    });

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runProgram(['card', 'list']);

    console.error = originalError;
    process.exit = originalExit;

    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    expect(errorSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card list handles 429 rate limiting', async () => {
    setRoute('GET', '/v1/cards', {
      status: 429,
      body: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    });

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runProgram(['card', 'list']);

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to list cards: Too many requests')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card get handles 503 server unavailable', async () => {
    setRoute('GET', `/v1/cards/${CARD_ID_1}`, {
      status: 503,
      body: { error: { code: 'UNAVAILABLE', message: 'Service unavailable' } },
    });

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runProgram(['card', 'get', CARD_ID_1]);

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to get card: Service unavailable')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card list validates invalid status argument', async () => {
    // With exitOverride applied recursively in createProgram, commander
    // throws a CommanderError on invalid arguments instead of calling
    // process.exit directly. The throw bubbles out of parseAsync.
    let thrown: unknown = null;
    try {
      await program.parseAsync(['node', 'anima', 'card', 'list', '--status', 'BROKEN']);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).not.toBeNull();
    const code = (thrown as { code?: string } | null)?.code ?? '';
    expect(code).toBe('commander.invalidArgument');
  });
});
