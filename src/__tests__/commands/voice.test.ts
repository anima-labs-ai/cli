import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-voice-config');

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

function createMockServer(routes: Record<string, (req: CapturedRequest) => Response>): void {
  mockServer?.stop();
  mockServer = Bun.serve({
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

      const key = `${req.method} ${url.pathname}`;
      const handler = routes[key];
      if (handler) {
        return handler(lastRequest);
      }

      // Try wildcard path matching for routes like GET /voice/calls/:id
      for (const [pattern, h] of Object.entries(routes)) {
        const [method, pathPattern] = pattern.split(' ');
        if (req.method === method && pathPattern && matchPath(url.pathname, pathPattern)) {
          return h(lastRequest);
        }
      }

      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not Found' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  serverPort = mockServer.port ?? 0;
}

function matchPath(actual: string, pattern: string): boolean {
  const actualParts = actual.split('/');
  const patternParts = pattern.split('/');
  if (actualParts.length !== patternParts.length) return false;
  return patternParts.every((p, i) => p.startsWith(':') || p === actualParts[i]);
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('voice commands', () => {
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
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true });
    }
    program = createProgram();
  });

  afterEach(() => {
    mockServer?.stop();
    mockServer = null;
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  // ── Catalog ──

  describe('voice catalog', () => {
    test('lists voices with filters', async () => {
      createMockServer({
        'GET /voice/catalog': () => jsonResponse({
          voices: [
            { id: 'v1', name: 'Aria', provider: 'elevenlabs', tier: 'premium', gender: 'female', language: 'en-US', style: 'warm' },
            { id: 'v2', name: 'Marcus', provider: 'telnyx', tier: 'basic', gender: 'male', language: 'en-US', style: 'neutral' },
          ],
        }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'voice', 'catalog', '--tier', 'premium']);
      } finally {
        console.log = originalLog;
      }

      expect(lastRequest?.method).toBe('GET');
      expect(lastRequest?.path).toBe('/voice/catalog');
      expect(lastRequest?.query.get('tier')).toBe('premium');
      expect(logSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('shows empty message when no voices', async () => {
      createMockServer({
        'GET /voice/catalog': () => jsonResponse({ voices: [] }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'voice', 'catalog']);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('No voices found');
    });

    test('supports json mode', async () => {
      createMockServer({
        'GET /voice/catalog': () => jsonResponse({
          voices: [{ id: 'v1', name: 'Test', provider: 'telnyx', tier: 'basic', language: 'en' }],
        }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', '--json', 'voice', 'catalog']);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('"voices"');
    });
  });

  // ── Calls list ──

  describe('voice calls', () => {
    test('lists calls with agent filter', async () => {
      createMockServer({
        'GET /voice/calls': () => jsonResponse({
          items: [
            {
              id: 'call-abc123def456',
              agentId: 'agent-1',
              direction: 'outbound',
              status: 'completed',
              from: '+14155550100',
              to: '+14155550200',
              tier: 'premium',
              durationSeconds: 125,
              startedAt: '2026-04-02T10:00:00Z',
            },
          ],
          total: 1,
        }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'voice', 'calls', '--agent', 'agent-1']);
      } finally {
        console.log = originalLog;
      }

      expect(lastRequest?.path).toBe('/voice/calls');
      expect(lastRequest?.query.get('agentId')).toBe('agent-1');
      expect(logSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('handles empty call list', async () => {
      createMockServer({
        'GET /voice/calls': () => jsonResponse({ items: [], total: 0 }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'voice', 'calls']);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('No calls found');
    });
  });

  // ── Get call ──

  describe('voice get', () => {
    test('displays call details', async () => {
      createMockServer({
        'GET /voice/calls/:id': () => jsonResponse({
          id: 'call-abc123',
          agentId: 'agent-1',
          direction: 'outbound',
          status: 'completed',
          from: '+14155550100',
          to: '+14155550200',
          tier: 'premium',
          voiceId: 'v1',
          durationSeconds: 90,
          startedAt: '2026-04-02T10:00:00Z',
          endedAt: '2026-04-02T10:01:30Z',
        }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'voice', 'get', 'call-abc123']);
      } finally {
        console.log = originalLog;
      }

      expect(lastRequest?.path).toBe('/voice/calls/call-abc123');
      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('outbound');
    });

    test('supports json mode', async () => {
      createMockServer({
        'GET /voice/calls/:id': () => jsonResponse({
          id: 'call-abc123',
          agentId: 'agent-1',
          direction: 'inbound',
          status: 'completed',
          from: '+14155550100',
          to: '+14155550200',
          tier: 'basic',
          startedAt: '2026-04-02T10:00:00Z',
        }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', '--json', 'voice', 'get', 'call-abc123']);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('"id"');
      expect(output).toContain('call-abc123');
    });
  });

  // ── Transcript ──

  describe('voice transcript', () => {
    test('displays transcript segments', async () => {
      createMockServer({
        'GET /voice/calls/:id/transcript': () => jsonResponse({
          callId: 'call-abc123',
          segments: [
            { speaker: 'agent', text: 'Hello, how can I help?', startTime: 0, endTime: 3 },
            { speaker: 'caller', text: 'I need help with my order', startTime: 3, endTime: 7 },
            { speaker: 'agent', text: 'Sure, let me look that up', startTime: 7, endTime: 10 },
          ],
        }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'voice', 'transcript', 'call-abc123']);
      } finally {
        console.log = originalLog;
      }

      expect(lastRequest?.path).toBe('/voice/calls/call-abc123/transcript');
      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('Hello, how can I help?');
      expect(output).toContain('I need help with my order');
    });

    test('filters by speaker', async () => {
      createMockServer({
        'GET /voice/calls/:id/transcript': () => jsonResponse({
          callId: 'call-abc123',
          segments: [
            { speaker: 'agent', text: 'Agent line', startTime: 0, endTime: 2 },
            { speaker: 'caller', text: 'Caller line', startTime: 2, endTime: 5 },
          ],
        }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync([
          'node', 'anima', 'voice', 'transcript', 'call-abc123', '--speaker', 'agent',
        ]);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('Agent line');
      expect(output).not.toContain('Caller line');
    });
  });

  // ── Summary ──

  describe('voice summary', () => {
    test('displays call summary', async () => {
      createMockServer({
        'GET /voice/calls/:id/summary': () => jsonResponse({
          callId: 'call-abc123',
          oneLiner: 'Customer inquired about order status',
          topics: ['order status', 'delivery'],
          actionItems: ['Check shipping ETA'],
          decisions: ['Provide tracking number'],
          openQuestions: [],
          nextSteps: ['Follow up in 24 hours'],
          intent: 'Order inquiry',
          outcome: 'Resolved',
          generatedAt: '2026-04-02T11:00:00Z',
        }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'voice', 'summary', 'call-abc123']);
      } finally {
        console.log = originalLog;
      }

      expect(lastRequest?.path).toBe('/voice/calls/call-abc123/summary');
      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('Customer inquired about order status');
      expect(output).toContain('Order inquiry');
    });

    test('handles API error', async () => {
      createMockServer({
        'GET /voice/calls/:id/summary': () => jsonResponse(
          { error: { code: 'NOT_FOUND', message: 'Summary not ready' } },
          404,
        ),
      });
      setAuthenticatedConfig(serverPort);

      const exitSpy = mock(() => {});
      const originalExit = process.exit;
      process.exit = exitSpy as unknown as typeof process.exit;
      const errorSpy = mock(() => {});
      const originalError = console.error;
      console.error = errorSpy;

      try {
        await program.parseAsync(['node', 'anima', 'voice', 'summary', 'call-xyz']);
      } catch {
      } finally {
        process.exit = originalExit;
        console.error = originalError;
      }

      expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
      const msg = String((errorSpy.mock.calls.at(0) as unknown[])?.[0] ?? '');
      expect(msg).toContain('Failed to get summary');
    });
  });

  // ── Score ──

  describe('voice score', () => {
    test('displays call score with subscores and metrics', async () => {
      createMockServer({
        'GET /voice/calls/:id/score': () => jsonResponse({
          callId: 'call-abc123',
          overallScore: 82,
          subscores: {
            resolution: 90,
            sentiment: 75,
            efficiency: 80,
            engagement: 85,
            latency: 70,
            compliance: 100,
          },
          metrics: {
            durationSeconds: 120,
            agentSpeakingSeconds: 60,
            callerSpeakingSeconds: 50,
            talkToListenRatio: 1.2,
            longestMonologueSeconds: 15,
            deadAirCount: 2,
            deadAirSeconds: 7,
            averageResponseLatencySeconds: 1.5,
          },
          scoredAt: '2026-04-02T11:00:00Z',
        }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'voice', 'score', 'call-abc123']);
      } finally {
        console.log = originalLog;
      }

      expect(lastRequest?.path).toBe('/voice/calls/call-abc123/score');
      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('82');
      expect(output).toContain('Resolution');
    });

    test('supports json mode', async () => {
      createMockServer({
        'GET /voice/calls/:id/score': () => jsonResponse({
          callId: 'c1',
          overallScore: 90,
          subscores: { resolution: 90, sentiment: 90, efficiency: 90, engagement: 90, latency: 90, compliance: 90 },
          metrics: {
            durationSeconds: 60, agentSpeakingSeconds: 30, callerSpeakingSeconds: 25,
            talkToListenRatio: 1.2, longestMonologueSeconds: 10, deadAirCount: 0,
            deadAirSeconds: 0, averageResponseLatencySeconds: 0.8,
          },
          scoredAt: '2026-04-02T11:00:00Z',
        }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', '--json', 'voice', 'score', 'c1']);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('"overallScore"');
    });
  });

  // ── Search ──

  describe('voice search', () => {
    test('sends search query to API', async () => {
      createMockServer({
        'POST /voice/search': () => jsonResponse({
          results: [
            { callId: 'c1', speaker: 'agent', text: 'Your order is ready', similarity: 0.92, startTime: 5, agentId: 'a1' },
          ],
        }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync([
          'node', 'anima', 'voice', 'search', 'order status',
          '--agent', 'agent-1',
          '--limit', '5',
        ]);
      } finally {
        console.log = originalLog;
      }

      expect(lastRequest?.method).toBe('POST');
      expect(lastRequest?.path).toBe('/voice/search');
      const body = JSON.parse(lastRequest?.bodyText ?? '{}') as { query: string; agentId: string; limit: number };
      expect(body.query).toBe('order status');
      expect(body.agentId).toBe('agent-1');
      expect(body.limit).toBe(5);
    });

    test('displays search results', async () => {
      createMockServer({
        'POST /voice/search': () => jsonResponse({
          results: [
            { callId: 'call-abc12345', speaker: 'agent', text: 'I can help with that order', similarity: 0.88, startTime: 10, agentId: 'a1' },
            { callId: 'call-def67890', speaker: 'caller', text: 'Where is my order?', similarity: 0.82, startTime: 3, agentId: 'a1' },
          ],
        }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'voice', 'search', 'order']);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('I can help with that order');
      expect(output).toContain('2 result(s)');
    });

    test('handles empty results', async () => {
      createMockServer({
        'POST /voice/search': () => jsonResponse({ results: [] }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'voice', 'search', 'nonexistent query']);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('No results found');
    });

    test('cross-channel search sends correct channels', async () => {
      createMockServer({
        'POST /voice/search/cross-channel': () => jsonResponse({
          results: [
            { id: 'r1', channel: 'voice', content: 'Call about billing', similarity: 0.9, createdAt: '2026-04-02T10:00:00Z', agentId: 'a1' },
            { id: 'r2', channel: 'email', content: 'Email about billing', similarity: 0.85, createdAt: '2026-04-02T09:00:00Z', agentId: 'a1' },
          ],
        }),
      });
      setAuthenticatedConfig(serverPort);

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'voice', 'search', 'billing', '--cross-channel']);
      } finally {
        console.log = originalLog;
      }

      expect(lastRequest?.path).toBe('/voice/search/cross-channel');
      const body = JSON.parse(lastRequest?.bodyText ?? '{}') as { channels: string[] };
      expect(body.channels).toEqual(['email', 'sms', 'voice']);

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('[voice]');
      expect(output).toContain('[email]');
    });
  });

  // ── Auth errors ──

  describe('authentication', () => {
    test('voice calls fails when not authenticated', async () => {
      const exitSpy = mock(() => {});
      const originalExit = process.exit;
      process.exit = exitSpy as unknown as typeof process.exit;
      const errorSpy = mock(() => {});
      const originalError = console.error;
      console.error = errorSpy;

      try {
        await program.parseAsync(['node', 'anima', 'voice', 'calls']);
      } catch {
      } finally {
        process.exit = originalExit;
        console.error = originalError;
      }

      expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
      const msg = String((errorSpy.mock.calls.at(0) as unknown[])?.[0] ?? '');
      expect(msg).toContain('Failed to list calls');
    });
  });
});
