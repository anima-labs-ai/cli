import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createProgram } from '../../cli.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-extension-config');

mock.module('env-paths', () => ({
  default: () => ({
    config: testConfigDir,
    data: testConfigDir,
    cache: testConfigDir,
    log: testConfigDir,
    temp: testConfigDir,
  }),
}));

function parseLastJsonLog(logSpy: ReturnType<typeof mock>): unknown {
  const calls = logSpy.mock.calls;
  const last = calls[calls.length - 1];
  const firstArg = last?.[0];
  if (typeof firstArg !== 'string') {
    return undefined;
  }
  return JSON.parse(firstArg);
}

describe('extension commands', () => {
  let program: Command;

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
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  test('status shows installed extension info when bridge config is present', async () => {
    // Seed the bridge config + a real extension directory. Previously this
    // was set up by `am extension install` (now removed); the extension
    // ships out-of-band, so the test directly fakes the on-disk state the
    // status command reads.
    const extensionDir = join(testConfigDir, 'chrome-extension');
    mkdirSync(extensionDir, { recursive: true });
    writeFileSync(
      join(testConfigDir, 'extension-config.json'),
      JSON.stringify(
        {
          installed: true,
          extensionDir,
          version: '0.1.0',
          installedAt: '2026-05-06T00:00:00.000Z',
        },
        null,
        2,
      ),
    );

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync(['node', 'anima', '--json', 'extension', 'status']);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      installed: boolean;
      version: string;
      directory: string;
      installedAt: string;
    };

    expect(payload.installed).toBe(true);
    expect(payload.version).toBe('0.1.0');
    expect(payload.directory).toBe(extensionDir);
    expect(payload.installedAt).toBe('2026-05-06T00:00:00.000Z');
  });

  test('status reports not installed when no config', async () => {
    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync(['node', 'anima', '--json', 'extension', 'status']);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as { installed: boolean };
    expect(payload.installed).toBe(false);
  });
});

// A CUID-shaped agent id so the contract's AgentIdSchema (cuid | cuid2)
// validation in the typed oRPC client accepts the arg before the request
// ever reaches the mock server.
const AGENT_ID = 'caaa00000000000000000agt01';

interface ConnectRouteResponse {
  status: number;
  body: unknown;
  assert?: (ctx: { url: URL; body: unknown }) => void;
}

describe('extension connect', () => {
  let program: Command;
  let mockServer: ReturnType<typeof Bun.serve> | null = null;
  const routes: Record<string, ConnectRouteResponse> = {};

  function setRoute(method: string, path: string, route: ConnectRouteResponse): void {
    routes[`${method} ${path}`] = route;
  }

  function writeAuthConfig(port: number): void {
    writeFileSync(
      join(testConfigDir, 'auth.json'),
      JSON.stringify({ token: 'test-token', apiUrl: `http://localhost:${port}` }),
    );
  }

  // Complete ConnectExtensionOutput-shaped response. oRPC derives the output
  // type from the Zod schema, so a partial mock leaves typed fields undefined.
  function buildConnectResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      agentId: AGENT_ID,
      connectUrl: 'https://console.useanima.sh/extension/connect?code=xyz',
      expiresAt: '2026-01-01T00:15:00.000Z',
      exchangeExpiresAt: '2026-01-01T00:01:00.000Z',
      policy: 'session',
      ...overrides,
    };
  }

  async function runProgram(args: string[]): Promise<void> {
    try {
      await program.parseAsync(['node', 'anima', ...args]);
    } catch {
      // Commander throws on process.exit in tests; swallow so assertions run.
    }
  }

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
    mkdirSync(testConfigDir, { recursive: true });

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const route = routes[`${req.method} ${url.pathname}`];
        if (!route) {
          return new Response(
            JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not Found' } }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }
        let body: unknown;
        if (req.method !== 'GET' && req.method !== 'DELETE') {
          const text = await req.text();
          if (text && (req.headers.get('content-type') ?? '').includes('application/json')) {
            body = JSON.parse(text) as unknown;
          }
        }
        route.assert?.({ url, body });
        return new Response(JSON.stringify(route.body), {
          status: route.status,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    mockServer = server;
    writeAuthConfig(server.port ?? 0);
  });

  afterEach(() => {
    mockServer?.stop();
    mockServer = null;
    for (const key of Object.keys(routes)) delete routes[key];
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  test('master-key path sends agentId in the request body', async () => {
    setRoute('POST', '/v1/extension/connect', {
      status: 200,
      body: buildConnectResponse(),
      assert: ({ body }) => {
        // With a master key the agent must be explicit; --agent maps to
        // the contract's `agentId`.
        expect(body).toEqual({ agentId: AGENT_ID });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'extension', 'connect', '--agent', AGENT_ID]);

    console.log = originalLog;
    const parsed = parseLastJsonLog(logSpy) as { connectUrl: string; agentId: string };
    expect(parsed.connectUrl).toBe('https://console.useanima.sh/extension/connect?code=xyz');
    expect(parsed.agentId).toBe(AGENT_ID);
  });

  test('agent-key path omits agentId when --agent is not passed', async () => {
    setRoute('POST', '/v1/extension/connect', {
      status: 200,
      body: buildConnectResponse({ expiresAt: null, policy: 'pre_approved' }),
      assert: ({ body }) => {
        // With an agent key the server resolves the agent from the
        // credential, so the CLI must not send an `agentId` key at all.
        expect(body).toEqual({});
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'extension', 'connect']);

    console.log = originalLog;
    const parsed = parseLastJsonLog(logSpy) as { connectUrl: string; policy: string };
    expect(parsed.connectUrl).toBe('https://console.useanima.sh/extension/connect?code=xyz');
    expect(parsed.policy).toBe('pre_approved');
  });

  test('forwards --ttl and prints connectUrl in human output', async () => {
    setRoute('POST', '/v1/extension/connect', {
      status: 200,
      body: buildConnectResponse(),
      assert: ({ body }) => {
        expect(body).toEqual({ agentId: AGENT_ID, ttl: '1h' });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    // No --json: human/agent output path. The connectUrl must still be
    // printed (never a token — the response has none).
    await runProgram(['extension', 'connect', '--agent', AGENT_ID, '--ttl', '1h']);

    console.log = originalLog;
    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('https://console.useanima.sh/extension/connect?code=xyz')).toBe(true);
  });

  test('surfaces ORPCError with a friendly message and exits non-zero', async () => {
    setRoute('POST', '/v1/extension/connect', {
      status: 400,
      body: { error: { code: 'BAD_REQUEST', message: 'agentId is required with a master key' } },
    });

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;
    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runProgram(['extension', 'connect']);

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output).toContain('Failed to connect extension: agentId is required with a master key');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
