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

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let serverPort = 0;
let program: Command;
let forceSearchError = false;

interface CapturedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  bodyText: string;
}

let lastRequest: CapturedRequest | null = null;

function setAuthenticatedConfig(port: number): void {
  const authPath = join(testConfigDir, 'auth.json');
  writeFileSync(authPath, JSON.stringify({
    token: 'test-token',
    apiUrl: `http://localhost:${port}`,
  }));
}

function parseBodyAsJson(request: CapturedRequest): unknown {
  if (!request.bodyText) {
    return undefined;
  }
  return JSON.parse(request.bodyText) as unknown;
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
    lastRequest = null;
    forceSearchError = false;
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true });
    }

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const bodyText = req.method === 'GET' ? '' : await req.text();

        lastRequest = {
          method: req.method,
          path: url.pathname,
          query: url.searchParams,
          bodyText,
        };

        if (url.pathname === '/api/v1/phone/search' && req.method === 'GET') {
          if (forceSearchError) {
            return new Response(JSON.stringify({
              error: {
                code: 'PHONE_ERROR',
                message: 'Phone service down',
              },
            }), { status: 503, headers: { 'Content-Type': 'application/json' } });
          }

          return new Response(JSON.stringify({
            numbers: [
              { number: '+14155550123', capabilities: ['sms', 'voice'], provider: 'twilio' },
            ],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (url.pathname === '/api/v1/phone/provision' && req.method === 'POST') {
          return new Response(JSON.stringify({
            number: '+14155550124',
            capabilities: ['sms'],
            provider: 'twilio',
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (url.pathname === '/api/v1/phone/numbers' && req.method === 'GET') {
          return new Response(JSON.stringify({
            numbers: [
              { number: '+14155550124', capabilities: ['sms'], provider: 'twilio' },
              { number: '+14155550125', capabilities: ['voice'], provider: 'telnyx' },
            ],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (url.pathname === '/api/v1/phone/release' && req.method === 'POST') {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.pathname === '/api/v1/phone/send-sms' && req.method === 'POST') {
          return new Response(JSON.stringify({
            id: 'sms-123',
            status: 'queued',
            to: '+14155550199',
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (url.pathname === '/api/v1/phone/error' && req.method === 'GET') {
          return new Response(JSON.stringify({
            error: {
              code: 'PHONE_ERROR',
              message: 'Phone service down',
            },
          }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not Found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    mockServer = server;
    serverPort = server.port ?? 0;

    program = createProgram();
  });

  afterEach(() => {
    mockServer?.stop();
    mockServer = null;
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  test('phone search sends expected query params and renders table', async () => {
    setAuthenticatedConfig(serverPort);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await program.parseAsync([
        'node', 'am',
        'phone', 'search',
        '--country', 'US',
        '--area-code', '415',
        '--capabilities', 'sms,voice',
        '--limit', '10',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(lastRequest).not.toBeNull();
    expect(lastRequest?.method).toBe('GET');
    expect(lastRequest?.path).toBe('/api/v1/phone/search');
    expect(lastRequest?.query.get('countryCode')).toBe('US');
    expect(lastRequest?.query.get('areaCode')).toBe('415');
    expect(lastRequest?.query.get('capabilities')).toBe('sms,voice');
    expect(lastRequest?.query.get('limit')).toBe('10');
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('phone search supports json mode output', async () => {
    setAuthenticatedConfig(serverPort);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await program.parseAsync(['node', 'am', '--json', 'phone', 'search']);
    } finally {
      console.log = originalLog;
    }

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
    const firstLogCall = logSpy.mock.calls.at(0) as unknown[] | undefined;
    const payload = String(firstLogCall?.[0] ?? '');
    expect(payload).toContain('numbers');
  });

  test('phone provision sends required payload', async () => {
    setAuthenticatedConfig(serverPort);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await program.parseAsync([
        'node', 'am',
        'phone', 'provision',
        '--agent', 'agent-1',
        '--country', 'US',
        '--area-code', '415',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(lastRequest).not.toBeNull();
    expect(lastRequest?.method).toBe('POST');
    expect(lastRequest?.path).toBe('/api/v1/phone/provision');
    const body = parseBodyAsJson(lastRequest as CapturedRequest) as {
      agentId: string;
      countryCode: string;
      areaCode?: string;
    };
    expect(body.agentId).toBe('agent-1');
    expect(body.countryCode).toBe('US');
    expect(body.areaCode).toBe('415');
  });

  test('phone list sends agent query param', async () => {
    setAuthenticatedConfig(serverPort);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await program.parseAsync(['node', 'am', 'phone', 'list', '--agent', 'agent-2']);
    } finally {
      console.log = originalLog;
    }

    expect(lastRequest).not.toBeNull();
    expect(lastRequest?.method).toBe('GET');
    expect(lastRequest?.path).toBe('/api/v1/phone/numbers');
    expect(lastRequest?.query.get('agentId')).toBe('agent-2');
  });

  test('phone release sends required payload', async () => {
    setAuthenticatedConfig(serverPort);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await program.parseAsync([
        'node', 'am',
        'phone', 'release',
        '--agent', 'agent-1',
        '--number', '+14155550124',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(lastRequest).not.toBeNull();
    expect(lastRequest?.method).toBe('POST');
    expect(lastRequest?.path).toBe('/api/v1/phone/release');
    const body = parseBodyAsJson(lastRequest as CapturedRequest) as {
      agentId: string;
      phoneNumber: string;
    };
    expect(body.agentId).toBe('agent-1');
    expect(body.phoneNumber).toBe('+14155550124');
  });

  test('phone send-sms sends required payload with media urls', async () => {
    setAuthenticatedConfig(serverPort);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await program.parseAsync([
        'node', 'am',
        'phone', 'send-sms',
        '--agent', 'agent-9',
        '--to', '+14155550199',
        '--body', 'Hello from CLI',
        '--media-url', 'https://example.com/a.png',
        '--media-url', 'https://example.com/b.png',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(lastRequest).not.toBeNull();
    expect(lastRequest?.method).toBe('POST');
    expect(lastRequest?.path).toBe('/api/v1/phone/send-sms');
    const body = parseBodyAsJson(lastRequest as CapturedRequest) as {
      agentId: string;
      to: string;
      body: string;
      mediaUrls?: string[];
    };
    expect(body.agentId).toBe('agent-9');
    expect(body.to).toBe('+14155550199');
    expect(body.body).toBe('Hello from CLI');
    expect(body.mediaUrls).toEqual(['https://example.com/a.png', 'https://example.com/b.png']);
  });

  test('phone search handles ApiError with user-friendly message', async () => {
    setAuthenticatedConfig(serverPort);

    forceSearchError = true;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await program.parseAsync(['node', 'am', 'phone', 'search']);
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

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await program.parseAsync([
        'node', 'am',
        'phone', 'send-sms',
        '--agent', 'agent-1',
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
    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await program.parseAsync(['node', 'am', 'phone', 'list', '--agent', 'agent-3']);
    } catch {
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }

    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    const firstErrorCall = errorSpy.mock.calls.at(0) as unknown[] | undefined;
    const message = String(firstErrorCall?.[0] ?? '');
    expect(message).toContain('Failed to list phone numbers');
  });

  test('phone search handles 429 rate limiting', async () => {
    setAuthenticatedConfig(serverPort);

    mockServer?.stop();
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    serverPort = mockServer.port ?? 0;
    setAuthenticatedConfig(serverPort);

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await program.parseAsync(['node', 'am', 'phone', 'search']);
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

  test('phone list handles malformed JSON response', async () => {
    setAuthenticatedConfig(serverPort);

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
    setAuthenticatedConfig(serverPort);

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await program.parseAsync(['node', 'am', 'phone', 'list', '--agent', 'agent-2']);
    } catch {
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }

    const firstErrorCall = errorSpy.mock.calls.at(0) as unknown[] | undefined;
    const message = String(firstErrorCall?.[0] ?? '');
    expect(message).toContain('Failed to parse JSON');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('phone provision handles network connection refused', async () => {
    setAuthenticatedConfig(serverPort);
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
      await program.parseAsync(['node', 'am', 'phone', 'provision', '--agent', 'agent-1']);
    } catch {
    } finally {
      process.exit = originalExit;
      console.error = originalError;
      globalThis.fetch = originalFetch;
    }

    const firstErrorCall = errorSpy.mock.calls.at(0) as unknown[] | undefined;
    const message = String(firstErrorCall?.[0] ?? '');
    expect(message).toContain('Failed to provision phone number: Network error: Connection refused');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('phone release handles timeout abort', async () => {
    setAuthenticatedConfig(serverPort);
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
      await program.parseAsync([
        'node',
        'am',
        'phone',
        'release',
        '--agent',
        'agent-1',
        '--number',
        '+14155550124',
      ]);
    } catch {
    } finally {
      process.exit = originalExit;
      console.error = originalError;
      globalThis.fetch = originalFetch;
    }

    const firstErrorCall = errorSpy.mock.calls.at(0) as unknown[] | undefined;
    const message = String(firstErrorCall?.[0] ?? '');
    expect(message).toContain('Failed to release phone number: Request timed out');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('phone list handles 500 server error', async () => {
    setAuthenticatedConfig(serverPort);

    mockServer?.stop();
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Unexpected failure' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    serverPort = mockServer.port ?? 0;
    setAuthenticatedConfig(serverPort);

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await program.parseAsync(['node', 'am', 'phone', 'list', '--agent', 'agent-2']);
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
