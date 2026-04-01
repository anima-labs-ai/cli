import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createProgram } from '../../cli.js';
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

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let program: Command;

interface CapturedRequest {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  body: unknown;
}

function writeAuthConfig(port: number): void {
  writeFileSync(join(testConfigDir, 'auth.json'), JSON.stringify({
    token: 'test-token',
    apiUrl: `http://localhost:${port}`,
  }));
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
  });

  afterEach(() => {
    mockServer?.stop();
    mockServer = null;
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  test('card create sends expected payload', async () => {
    const capturedRequests: CapturedRequest[] = [];

    mockServer = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method === 'POST' && url.pathname === '/api/cards') {
          const body = await request.json();
          capturedRequests.push({
            method: request.method,
            pathname: url.pathname,
            searchParams: url.searchParams,
            body,
          });
          return new Response(JSON.stringify({
            id: 'card_1',
            agentId: 'agent_1',
            label: 'Primary',
            status: 'ACTIVE',
            currency: 'usd',
            spendLimits: { daily: 5000, monthly: 15000, perAuth: 3000 },
            createdAt: '2026-03-19T00:00:00Z',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ error: { message: 'not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    writeAuthConfig(mockServer.port ?? 0);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await program.parseAsync([
        'node', 'anima',
        'card', 'create',
        '--agent', 'agent_1',
        '--label', 'Primary',
        '--daily-limit', '5000',
        '--monthly-limit', '15000',
        '--per-auth-limit', '3000',
      ]);
    } catch {
    }

    console.log = originalLog;

    const captured = capturedRequests[0];
    expect(captured?.method).toBe('POST');
    expect(captured?.pathname).toBe('/api/cards');
    expect(captured?.body).toEqual({
      agentId: 'agent_1',
      label: 'Primary',
      currency: 'usd',
      spendLimitDaily: 5000,
      spendLimitMonthly: 15000,
      spendLimitPerAuth: 3000,
    });
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card list sends expected query', async () => {
    const capturedRequests: CapturedRequest[] = [];

    mockServer = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/api/cards') {
          capturedRequests.push({
            method: request.method,
            pathname: url.pathname,
            searchParams: url.searchParams,
            body: null,
          });
          return new Response(JSON.stringify({
            data: [
              {
                id: 'card_1',
                agentId: 'agent_1',
                label: 'Primary',
                status: 'ACTIVE',
                currency: 'usd',
                spendLimits: { daily: 5000 },
                createdAt: '2026-03-19T00:00:00Z',
              },
            ],
            nextCursor: 'cur_2',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ error: { message: 'not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    writeAuthConfig(mockServer.port ?? 0);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await program.parseAsync([
        'node', 'anima',
        'card', 'list',
        '--agent', 'agent_1',
        '--status', 'ACTIVE',
        '--limit', '25',
      ]);
    } catch {
    }

    console.log = originalLog;

    const captured = capturedRequests[0];
    expect(captured?.pathname).toBe('/api/cards');
    expect(captured?.searchParams.get('agentId')).toBe('agent_1');
    expect(captured?.searchParams.get('status')).toBe('ACTIVE');
    expect(captured?.searchParams.get('limit')).toBe('25');
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card get supports json output', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/api/cards/card_1') {
          return new Response(JSON.stringify({
            id: 'card_1',
            agentId: 'agent_1',
            label: 'Primary',
            status: 'ACTIVE',
            currency: 'usd',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ error: { message: 'not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    writeAuthConfig(mockServer.port ?? 0);

    const logSpy = mock((..._args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await program.parseAsync(['node', 'anima', '--json', 'card', 'get', 'card_1']);
    } catch {
    }

    console.log = originalLog;

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
    const firstArg = logSpy.mock.calls[0]?.[0];
    expect(typeof firstArg).toBe('string');
    if (typeof firstArg === 'string') {
      expect(JSON.parse(firstArg)).toEqual({
        id: 'card_1',
        agentId: 'agent_1',
        label: 'Primary',
        status: 'ACTIVE',
        currency: 'usd',
      });
    }
  });

  test('card update sends expected payload', async () => {
    const capturedRequests: CapturedRequest[] = [];

    mockServer = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method === 'PUT' && url.pathname === '/api/cards/card_1') {
          const body = await request.json();
          capturedRequests.push({
            method: request.method,
            pathname: url.pathname,
            searchParams: url.searchParams,
            body,
          });
          return new Response(JSON.stringify({
            id: 'card_1',
            agentId: 'agent_1',
            label: 'Updated',
            status: 'FROZEN',
            currency: 'usd',
            spendLimits: { daily: 7000, monthly: 20000, perAuth: 2500 },
            updatedAt: '2026-03-19T01:00:00Z',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ error: { message: 'not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    writeAuthConfig(mockServer.port ?? 0);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await program.parseAsync([
        'node', 'anima',
        'card', 'update', 'card_1',
        '--label', 'Updated',
        '--status', 'FROZEN',
        '--daily-limit', '7000',
        '--monthly-limit', '20000',
        '--per-auth-limit', '2500',
      ]);
    } catch {
    }

    console.log = originalLog;

    const captured = capturedRequests[0];
    expect(captured?.pathname).toBe('/api/cards/card_1');
    expect(captured?.body).toEqual({
      label: 'Updated',
      status: 'FROZEN',
      spendLimits: {
        daily: 7000,
        monthly: 20000,
        perAuth: 2500,
      },
    });
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card delete hits delete endpoint', async () => {
    const capturedRequests: CapturedRequest[] = [];

    mockServer = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (request.method === 'DELETE' && url.pathname === '/api/cards/card_1') {
          capturedRequests.push({
            method: request.method,
            pathname: url.pathname,
            searchParams: url.searchParams,
            body: null,
          });
          return new Response(JSON.stringify({ deleted: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ error: { message: 'not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    writeAuthConfig(mockServer.port ?? 0);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await program.parseAsync(['node', 'anima', 'card', 'delete', 'card_1']);
    } catch {
    }

    console.log = originalLog;

    const captured = capturedRequests[0];
    expect(captured?.method).toBe('DELETE');
    expect(captured?.pathname).toBe('/api/cards/card_1');
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card transactions sends expected query', async () => {
    const capturedRequests: CapturedRequest[] = [];

    mockServer = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/api/cards/transactions') {
          capturedRequests.push({
            method: request.method,
            pathname: url.pathname,
            searchParams: url.searchParams,
            body: null,
          });
          return new Response(JSON.stringify({
            data: [
              {
                id: 'txn_1',
                cardId: 'card_1',
                agentId: 'agent_1',
                status: 'PENDING',
                amount: 1234,
                currency: 'usd',
                merchantName: 'Coffee Shop',
                createdAt: '2026-03-19T02:00:00Z',
              },
            ],
            nextCursor: 'txn_cursor_2',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ error: { message: 'not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    writeAuthConfig(mockServer.port ?? 0);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await program.parseAsync([
        'node', 'anima',
        'card', 'transactions',
        '--card', 'card_1',
        '--agent', 'agent_1',
        '--status', 'PENDING',
        '--limit', '10',
      ]);
    } catch {
    }

    console.log = originalLog;

    const captured = capturedRequests[0];
    expect(captured?.pathname).toBe('/api/cards/transactions');
    expect(captured?.searchParams.get('cardId')).toBe('card_1');
    expect(captured?.searchParams.get('agentId')).toBe('agent_1');
    expect(captured?.searchParams.get('status')).toBe('PENDING');
    expect(captured?.searchParams.get('limit')).toBe('10');
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card kill-switch sends expected payload', async () => {
    const capturedRequests: CapturedRequest[] = [];

    mockServer = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method === 'POST' && url.pathname === '/api/cards/kill-switch') {
          const body = await request.json();
          capturedRequests.push({
            method: request.method,
            pathname: url.pathname,
            searchParams: url.searchParams,
            body,
          });
          return new Response(JSON.stringify({
            active: true,
            cardId: 'card_1',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ error: { message: 'not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    writeAuthConfig(mockServer.port ?? 0);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await program.parseAsync(['node', 'anima', 'card', 'kill-switch', '--active', '--card', 'card_1']);
    } catch {
    }

    console.log = originalLog;

    const captured = capturedRequests[0];
    expect(captured?.pathname).toBe('/api/cards/kill-switch');
    expect(captured?.body).toEqual({
      active: true,
      cardId: 'card_1',
    });
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card commands handle ApiError responses', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'invalid card request' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    writeAuthConfig(mockServer.port ?? 0);

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await program.parseAsync(['node', 'anima', 'card', 'list']);
    } catch {
    }

    console.error = originalError;
    process.exit = originalExit;

    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    expect(errorSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card list handles 429 rate limiting', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    writeAuthConfig(mockServer.port ?? 0);

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await program.parseAsync(['node', 'anima', 'card', 'list']);
    } catch {
    }

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to list cards: Too many requests')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card get handles 503 server unavailable', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Service unavailable' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    writeAuthConfig(mockServer.port ?? 0);

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await program.parseAsync(['node', 'anima', 'card', 'get', 'card_1']);
    } catch {
    }

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to get card: Service unavailable')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card transactions handles malformed JSON response', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response('{ bad json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    writeAuthConfig(mockServer.port ?? 0);

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await program.parseAsync(['node', 'anima', 'card', 'transactions']);
    } catch {
    }

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to list transactions:')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card create handles network connection refused', async () => {
    writeAuthConfig(65535);

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

    try {
      await program.parseAsync(['node', 'anima', 'card', 'create', '--agent', 'agent_1']);
    } catch {
    }

    globalThis.fetch = originalFetch;
    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to create card: Network error: Connection refused')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card delete handles timeout abort', async () => {
    writeAuthConfig(65535);

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

    try {
      await program.parseAsync(['node', 'anima', 'card', 'delete', 'card_1']);
    } catch {
    }

    globalThis.fetch = originalFetch;
    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Failed to delete card: Request timed out')).toBe(true);
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('card list validates invalid status argument', async () => {
    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await program.parseAsync(['node', 'anima', 'card', 'list', '--status', 'BROKEN']);
    } catch {
    }

    console.error = originalError;
    process.exit = originalExit;

    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
