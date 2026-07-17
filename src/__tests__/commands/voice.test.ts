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

// Real-looking CUIDs (25 chars, c[a-z0-9]{24}) so that any contract field
// validation in the typed oRPC client doesn't reject the test inputs before
// the request reaches the mock server.
const AGENT_ID_1 = 'caaa00000000000000000agt01';
const CALL_ID_1 = 'caaa00000000000000000call1';
const CALL_ID_2 = 'caaa00000000000000000call2';
const CALL_MISS = 'caaa00000000000000000miss1';

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

// Build a complete CallSchema-shaped response. oRPC contracts derive output
// types from Zod schemas, so partial mock responses cause undefined fields
// when commands access typed fields like `call.endReason`.
function buildCallResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CALL_ID_1,
    agentId: AGENT_ID_1,
    phoneIdentityId: 'caaa00000000000000000phn01',
    direction: 'OUTBOUND',
    tier: 'premium',
    state: 'ENDED',
    from: '+14155550100',
    to: '+14155550200',
    startedAt: '2026-04-02T10:00:00.000Z',
    answeredAt: '2026-04-02T10:00:05.000Z',
    endedAt: '2026-04-02T10:01:30.000Z',
    endReason: 'completed',
    durationSeconds: 90,
    createdAt: '2026-04-02T10:00:00.000Z',
    ...overrides,
  };
}

// Build a complete VoiceSchema-shaped catalog entry.
function buildVoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'v1',
    name: 'Aria',
    provider: 'elevenlabs',
    tier: 'premium',
    gender: 'female',
    language: 'en-US',
    style: 'warm',
    ...overrides,
  };
}

// GetSummaryOutput shape — actionItems is { text, owner } objects, not strings.
function buildSummaryResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    callId: CALL_ID_1,
    oneLiner: 'Customer inquired about order status',
    topics: ['order status', 'delivery'],
    actionItems: [{ text: 'Check shipping ETA', owner: null }],
    decisions: ['Provide tracking number'],
    openQuestions: [],
    nextSteps: ['Follow up in 24 hours'],
    intent: 'Order inquiry',
    outcome: 'Resolved',
    narrative: null,
    generatedAt: '2026-04-02T11:00:00.000Z',
    ...overrides,
  };
}

// GetScoreOutput shape — composite/sub*Score fields, metrics is a record.
function buildScoreResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    callId: CALL_ID_1,
    compositeScore: 82,
    resolutionScore: 90,
    sentimentScore: 75,
    complianceScore: 100,
    efficiencyScore: 80,
    engagementScore: 85,
    latencyScore: 70,
    metrics: {
      durationSeconds: 120,
      agentSpeakingSeconds: 60,
    },
    scoredAt: '2026-04-02T11:00:00.000Z',
    ...overrides,
  };
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

  // ── Catalog ──

  describe('voice catalog', () => {
    test('lists voices with filters', async () => {
      setAuthenticatedConfig(serverPort);
      setRoute('GET', '/v1/voice/catalog', {
        status: 200,
        body: {
          voices: [
            buildVoice({ id: 'v1', name: 'Aria', provider: 'elevenlabs', tier: 'premium' }),
            buildVoice({ id: 'v2', name: 'Marcus', provider: 'telnyx', tier: 'basic', gender: 'male', style: 'neutral' }),
          ],
        },
        assert: ({ url }) => {
          expect(url.searchParams.get('tier')).toBe('premium');
        },
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['voice', 'catalog', '--tier', 'premium']);
      } finally {
        console.log = originalLog;
      }

      expect(logSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('shows empty message when no voices', async () => {
      setAuthenticatedConfig(serverPort);
      setRoute('GET', '/v1/voice/catalog', {
        status: 200,
        body: { voices: [] },
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['voice', 'catalog']);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('No voices found');
    });

    test('supports json mode', async () => {
      setAuthenticatedConfig(serverPort);
      setRoute('GET', '/v1/voice/catalog', {
        status: 200,
        body: { voices: [buildVoice({ id: 'v1', name: 'Test', provider: 'telnyx', tier: 'basic', language: 'en' })] },
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['--json', 'voice', 'catalog']);
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
      setAuthenticatedConfig(serverPort);
      setRoute('GET', '/v1/voice/calls', {
        status: 200,
        body: {
          calls: [buildCallResponse({ id: CALL_ID_1, agentId: AGENT_ID_1 })],
          total: 1,
        },
        assert: ({ url }) => {
          expect(url.searchParams.get('agentId')).toBe(AGENT_ID_1);
        },
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['voice', 'calls', '--agent', AGENT_ID_1]);
      } finally {
        console.log = originalLog;
      }

      expect(logSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('handles empty call list', async () => {
      setAuthenticatedConfig(serverPort);
      setRoute('GET', '/v1/voice/calls', {
        status: 200,
        body: { calls: [], total: 0 },
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['voice', 'calls']);
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
      setAuthenticatedConfig(serverPort);
      setRoute('GET', `/v1/voice/calls/${CALL_ID_1}`, {
        status: 200,
        body: buildCallResponse({ id: CALL_ID_1, direction: 'OUTBOUND' }),
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['voice', 'get', CALL_ID_1]);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('OUTBOUND');
    });

    test('supports json mode', async () => {
      setAuthenticatedConfig(serverPort);
      setRoute('GET', `/v1/voice/calls/${CALL_ID_1}`, {
        status: 200,
        body: buildCallResponse({ id: CALL_ID_1, direction: 'INBOUND', tier: 'basic' }),
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['--json', 'voice', 'get', CALL_ID_1]);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('"id"');
      expect(output).toContain(CALL_ID_1);
    });
  });

  // ── Transcript ──

  describe('voice transcript', () => {
    test('displays transcript segments', async () => {
      setAuthenticatedConfig(serverPort);
      setRoute('GET', `/v1/voice/calls/${CALL_ID_1}/transcript`, {
        status: 200,
        body: {
          callId: CALL_ID_1,
          segments: [
            { speaker: 'agent', text: 'Hello, how can I help?', startTime: 0, endTime: 3, confidence: 0.95, isFinal: true },
            { speaker: 'caller', text: 'I need help with my order', startTime: 3, endTime: 7, confidence: 0.92, isFinal: true },
            { speaker: 'agent', text: 'Sure, let me look that up', startTime: 7, endTime: 10, confidence: 0.94, isFinal: true },
          ],
        },
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['voice', 'transcript', CALL_ID_1]);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('Hello, how can I help?');
      expect(output).toContain('I need help with my order');
    });

    test('filters by speaker', async () => {
      setAuthenticatedConfig(serverPort);
      setRoute('GET', `/v1/voice/calls/${CALL_ID_1}/transcript`, {
        status: 200,
        body: {
          callId: CALL_ID_1,
          segments: [
            { speaker: 'agent', text: 'Agent line', startTime: 0, endTime: 2, confidence: 0.95, isFinal: true },
            { speaker: 'caller', text: 'Caller line', startTime: 2, endTime: 5, confidence: 0.92, isFinal: true },
          ],
        },
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['voice', 'transcript', CALL_ID_1, '--speaker', 'agent']);
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
      setAuthenticatedConfig(serverPort);
      setRoute('GET', `/v1/voice/calls/${CALL_ID_1}/summary`, {
        status: 200,
        body: buildSummaryResponse(),
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['voice', 'summary', CALL_ID_1]);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('Customer inquired about order status');
      expect(output).toContain('Order inquiry');
    });

    test('handles API error', async () => {
      setAuthenticatedConfig(serverPort);
      setRoute('GET', `/v1/voice/calls/${CALL_MISS}/summary`, {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'Summary not ready' } },
      });

      const exitSpy = mock((...args: unknown[]) => {});
      const originalExit = process.exit;
      process.exit = exitSpy as unknown as typeof process.exit;
      const errorSpy = mock((...args: unknown[]) => {});
      const originalError = console.error;
      console.error = errorSpy;

      try {
        await runProgram(['voice', 'summary', CALL_MISS]);
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
      setAuthenticatedConfig(serverPort);
      setRoute('GET', `/v1/voice/calls/${CALL_ID_1}/score`, {
        status: 200,
        body: buildScoreResponse(),
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['voice', 'score', CALL_ID_1]);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('82');
      expect(output).toContain('Resolution');
    });

    test('supports json mode', async () => {
      setAuthenticatedConfig(serverPort);
      setRoute('GET', `/v1/voice/calls/${CALL_ID_1}/score`, {
        status: 200,
        body: buildScoreResponse({ compositeScore: 90 }),
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['--json', 'voice', 'score', CALL_ID_1]);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('"compositeScore"');
    });
  });

  // ── Search ──

  describe('voice search', () => {
    test('sends search query to API', async () => {
      setAuthenticatedConfig(serverPort);
      setRoute('POST', '/v1/voice/search', {
        status: 200,
        body: {
          results: [
            {
              callId: CALL_ID_1,
              speaker: 'agent',
              matchedText: 'Your order is ready',
              similarity: 0.92,
              startTime: 5,
              endTime: 8,
              chunkType: 'segment',
            },
          ],
        },
        assert: ({ body }) => {
          const b = body as { query: string; agentId: string; limit: number };
          expect(b.query).toBe('order status');
          expect(b.agentId).toBe(AGENT_ID_1);
          expect(b.limit).toBe(5);
        },
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram([
          'voice', 'search', 'order status',
          '--agent', AGENT_ID_1,
          '--limit', '5',
        ]);
      } finally {
        console.log = originalLog;
      }

      expect(logSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('displays search results', async () => {
      setAuthenticatedConfig(serverPort);
      setRoute('POST', '/v1/voice/search', {
        status: 200,
        body: {
          results: [
            {
              callId: CALL_ID_1,
              speaker: 'agent',
              matchedText: 'I can help with that order',
              similarity: 0.88,
              startTime: 10,
              endTime: 13,
              chunkType: 'segment',
            },
            {
              callId: CALL_ID_2,
              speaker: 'caller',
              matchedText: 'Where is my order?',
              similarity: 0.82,
              startTime: 3,
              endTime: 5,
              chunkType: 'segment',
            },
          ],
        },
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['voice', 'search', 'order']);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('I can help with that order');
      expect(output).toContain('2 result(s)');
    });

    test('handles empty results', async () => {
      setAuthenticatedConfig(serverPort);
      setRoute('POST', '/v1/voice/search', {
        status: 200,
        body: { results: [] },
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['voice', 'search', 'nonexistent query']);
      } finally {
        console.log = originalLog;
      }

      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('No results found');
    });

    test('cross-channel search sends correct channels', async () => {
      setAuthenticatedConfig(serverPort);
      setRoute('POST', '/v1/voice/search/cross-channel', {
        status: 200,
        body: {
          results: [
            { id: 'r1', channel: 'voice', content: 'Call about billing', similarity: 0.9, createdAt: '2026-04-02T10:00:00.000Z', agentId: AGENT_ID_1 },
            { id: 'r2', channel: 'email', content: 'Email about billing', similarity: 0.85, createdAt: '2026-04-02T09:00:00.000Z', agentId: AGENT_ID_1 },
          ],
        },
        assert: ({ body }) => {
          const b = body as { channels: string[] };
          expect(b.channels).toEqual(['email', 'sms', 'voice']);
        },
      });

      const logSpy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await runProgram(['voice', 'search', 'billing', '--cross-channel']);
      } finally {
        console.log = originalLog;
      }

      // Default agent format: assert on JSON channel values, not human-format
      // bracket badges (which only render with --human).
      const output = logSpy.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
      expect(output).toContain('"channel":"voice"');
      expect(output).toContain('"channel":"email"');
    });
  });

  // ── Auth errors ──

  describe('authentication', () => {
    test('voice calls fails when not authenticated', async () => {
      const exitSpy = mock((...args: unknown[]) => {});
      const originalExit = process.exit;
      process.exit = exitSpy as unknown as typeof process.exit;
      const errorSpy = mock((...args: unknown[]) => {});
      const originalError = console.error;
      console.error = errorSpy;

      try {
        await runProgram(['voice', 'calls']);
      } catch {
      } finally {
        process.exit = originalExit;
        console.error = originalError;
      }

      expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    });
  });
});
