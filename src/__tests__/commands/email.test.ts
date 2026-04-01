import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createProgram } from '../../cli.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';

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

let program: Command;
let server: ReturnType<typeof Bun.serve> | null = null;

function firstCallArg(spy: ReturnType<typeof mock>): unknown {
  const calls = (spy as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls[0]?.[0];
}

function setAuthConfig(port: number): void {
  const authPath = join(testConfigDir, 'auth.json');
  writeFileSync(
    authPath,
    JSON.stringify({
      token: 'test-token',
      apiUrl: `http://localhost:${port}`,
    }),
  );
}

function startServer(fetch: (request: Request) => Response | Promise<Response>): number {
  server = Bun.serve({ port: 0, fetch });
  if (!server) {
    throw new Error('Failed to start test server');
  }
  const port = server.port;
  if (port === undefined) {
    throw new Error('Test server port is undefined');
  }
  return port;
}

async function runCli(args: string[]): Promise<void> {
  try {
    await program.parseAsync(['node', 'anima', ...args]);
  } catch {
  }
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
  });

  afterEach(() => {
    server?.stop();
    server = null;
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  test.serial('email send sends expected payload', async () => {
    let capturedMethod = '';
    let capturedPath = '';
    let capturedQuery = '';
    let capturedBody: unknown;

    const port = startServer(async (request) => {
      const url = new URL(request.url);
      capturedMethod = request.method;
      capturedPath = url.pathname;
      capturedQuery = url.search;
      capturedBody = await request.json();

      return new Response(JSON.stringify({ id: 'em_123', status: 'queued' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    setAuthConfig(port);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli([
      '--json',
      'email',
      'send',
      '--agent',
      'agent_1',
      '--to',
      'a@example.com',
      '--to',
      'b@example.com',
      '--cc',
      'c@example.com',
      '--bcc',
      'd@example.com',
      '--subject',
      'Hello',
      '--body',
      'Body',
      '--html',
      '<p>Body</p>',
    ]);

    console.log = originalLog;

    expect(capturedMethod).toBe('POST');
    expect(capturedPath).toBe('/api/email/send');
    expect(capturedQuery).toBe('');
    expect(capturedBody).toEqual({
      agentId: 'agent_1',
      to: ['a@example.com', 'b@example.com'],
      cc: ['c@example.com'],
      bcc: ['d@example.com'],
      subject: 'Hello',
      body: 'Body',
      bodyHtml: '<p>Body</p>',
    });

    const output = JSON.parse(String(firstCallArg(logSpy) ?? '{}')) as { id: string };
    expect(output.id).toBe('em_123');
  });

  test.serial('email list sends pagination and agent query', async () => {
    let capturedMethod = '';
    let capturedPath = '';
    let capturedQuery = '';

    const port = startServer((request) => {
      const url = new URL(request.url);
      capturedMethod = request.method;
      capturedPath = url.pathname;
      capturedQuery = url.search;

      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'em_1',
              agentId: 'agent_1',
              subject: 'Welcome',
              status: 'sent',
              to: ['a@example.com'],
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          nextCursor: 'cur_2',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    setAuthConfig(port);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['--json', 'email', 'list', '--cursor', 'cur_1', '--limit', '10', '--agent', 'agent_1']);

    console.log = originalLog;

    expect(capturedMethod).toBe('GET');
    expect(capturedPath).toBe('/api/email');
    expect(capturedQuery).toContain('cursor=cur_1');
    expect(capturedQuery).toContain('limit=10');
    expect(capturedQuery).toContain('agentId=agent_1');

    const output = JSON.parse(String(firstCallArg(logSpy) ?? '{}')) as {
      data: Array<{ id: string }>;
      nextCursor: string;
    };
    expect(output.data[0]?.id).toBe('em_1');
    expect(output.nextCursor).toBe('cur_2');
  });

  test.serial('email get fetches by id', async () => {
    let capturedPath = '';

    const port = startServer((request) => {
      capturedPath = new URL(request.url).pathname;
      return new Response(
        JSON.stringify({
          id: 'em_777',
          agentId: 'agent_9',
          subject: 'Subj',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    setAuthConfig(port);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['--json', 'email', 'get', 'em_777']);

    console.log = originalLog;

    expect(capturedPath).toBe('/api/email/em_777');
    const output = JSON.parse(String(firstCallArg(logSpy) ?? '{}')) as { id: string };
    expect(output.id).toBe('em_777');
  });

  test.serial('email domains add lowercases domain', async () => {
    let capturedBody: unknown;

    const port = startServer(async (request) => {
      capturedBody = await request.json();
      return new Response(JSON.stringify({ id: 'dom_1', domain: 'example.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    setAuthConfig(port);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['--json', 'email', 'domains', 'add', 'Example.COM']);

    console.log = originalLog;

    expect(capturedBody).toEqual({ domain: 'example.com' });
    const output = JSON.parse(String(firstCallArg(logSpy) ?? '{}')) as { id: string };
    expect(output.id).toBe('dom_1');
  });

  test.serial('email domains verify posts domainId', async () => {
    let capturedMethod = '';
    let capturedPath = '';
    let capturedBody: unknown;

    const port = startServer(async (request) => {
      const url = new URL(request.url);
      capturedMethod = request.method;
      capturedPath = url.pathname;
      capturedBody = await request.json();
      return new Response(JSON.stringify({ id: 'dom_42', verified: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    setAuthConfig(port);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['--json', 'email', 'domains', 'verify', 'dom_42']);

    console.log = originalLog;

    expect(capturedMethod).toBe('POST');
    expect(capturedPath).toBe('/api/domains/dom_42/verify');
    expect(capturedBody).toEqual({ domainId: 'dom_42' });
  });

  test.serial('email domains list calls list endpoint', async () => {
    let capturedPath = '';

    const port = startServer((request) => {
      capturedPath = new URL(request.url).pathname;
      return new Response(JSON.stringify({ data: [{ id: 'dom_1', domain: 'example.com' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    setAuthConfig(port);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['--json', 'email', 'domains', 'list']);

    console.log = originalLog;

    expect(capturedPath).toBe('/api/domains');
    const output = JSON.parse(String(firstCallArg(logSpy) ?? '{}')) as {
      data: Array<{ id: string }>;
    };
    expect(output.data[0]?.id).toBe('dom_1');
  });

  test.serial('email domains get fetches details by id', async () => {
    let capturedPath = '';

    const port = startServer((request) => {
      capturedPath = new URL(request.url).pathname;
      return new Response(JSON.stringify({ id: 'dom_2', domain: 'foo.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    setAuthConfig(port);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['--json', 'email', 'domains', 'get', 'dom_2']);

    console.log = originalLog;

    expect(capturedPath).toBe('/api/domains/dom_2');
  });

  test.serial('email domains delete calls delete endpoint', async () => {
    let capturedMethod = '';
    let capturedPath = '';

    const port = startServer((request) => {
      const url = new URL(request.url);
      capturedMethod = request.method;
      capturedPath = url.pathname;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    setAuthConfig(port);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['--json', 'email', 'domains', 'delete', 'dom_3']);

    console.log = originalLog;

    expect(capturedMethod).toBe('DELETE');
    expect(capturedPath).toBe('/api/domains/dom_3');
  });

  test.serial('email domains dns fetches dns records', async () => {
    let capturedPath = '';

    const port = startServer((request) => {
      capturedPath = new URL(request.url).pathname;
      return new Response(
        JSON.stringify({
          records: [{ type: 'TXT', name: '@', value: 'v=spf1 include:mail', priority: 10 }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    setAuthConfig(port);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['--json', 'email', 'domains', 'dns', 'dom_4']);

    console.log = originalLog;

    expect(capturedPath).toBe('/api/domains/dom_4/dns-records');
    const output = JSON.parse(String(firstCallArg(logSpy) ?? '{}')) as {
      records: Array<{ type: string }>;
    };
    expect(output.records[0]?.type).toBe('TXT');
  });

  test.serial('email domains deliverability fetches metrics', async () => {
    let capturedPath = '';

    const port = startServer((request) => {
      capturedPath = new URL(request.url).pathname;
      return new Response(
        JSON.stringify({
          sent: 100,
          delivered: 95,
          bounced: 4,
          complained: 1,
          deliveryRate: 0.95,
          bounceRate: 0.04,
          complaintRate: 0.01,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    setAuthConfig(port);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runCli(['--json', 'email', 'domains', 'deliverability', 'dom_5']);

    console.log = originalLog;

    expect(capturedPath).toBe('/api/domains/dom_5/deliverability');
    const output = JSON.parse(String(firstCallArg(logSpy) ?? '{}')) as { sent: number };
    expect(output.sent).toBe(100);
  });

  test.serial('email send handles api errors with friendly message', async () => {
    const port = startServer(() => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid recipient',
          },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    setAuthConfig(port);

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runCli([
      'email',
      'send',
      '--agent',
      'agent_1',
      '--to',
      'a@example.com',
      '--subject',
      'S',
      '--body',
      'B',
    ]);

    process.exit = originalExit;
    console.error = originalError;

    expect(errorSpy.mock.calls.length).toBeGreaterThan(0);
    expect(String(firstCallArg(errorSpy) ?? '')).toContain('Failed to send email: Invalid recipient');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test.serial('email send handles 429 rate limiting', async () => {
    const port = startServer(() => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests',
          },
        }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    setAuthConfig(port);

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runCli([
      'email',
      'send',
      '--agent',
      'agent_1',
      '--to',
      'a@example.com',
      '--subject',
      'S',
      '--body',
      'B',
    ]);

    process.exit = originalExit;
    console.error = originalError;

    expect(String(firstCallArg(errorSpy) ?? '')).toContain('Failed to send email: Too many requests');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test.serial('email list handles 503 server unavailable', async () => {
    const port = startServer(() => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'UNAVAILABLE',
            message: 'Service unavailable',
          },
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    setAuthConfig(port);

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runCli(['email', 'list']);

    process.exit = originalExit;
    console.error = originalError;

    expect(String(firstCallArg(errorSpy) ?? '')).toContain('Failed to list emails: Service unavailable');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test.serial('email get handles malformed JSON response', async () => {
    const port = startServer(() => {
      return new Response('{ bad json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    setAuthConfig(port);

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runCli(['email', 'get', 'em_123']);

    process.exit = originalExit;
    console.error = originalError;

    expect(String(firstCallArg(errorSpy) ?? '')).toContain('Failed to get email:');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test.serial('email send handles network connection refused', async () => {
    setAuthConfig(65535);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new TypeError('Connection refused');
    }) as unknown as typeof fetch;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runCli([
      'email',
      'send',
      '--agent',
      'agent_1',
      '--to',
      'a@example.com',
      '--subject',
      'S',
      '--body',
      'B',
    ]);

    globalThis.fetch = originalFetch;
    process.exit = originalExit;
    console.error = originalError;

    expect(String(firstCallArg(errorSpy) ?? '')).toContain('Failed to send email: Network error: Connection refused');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test.serial('email send handles timeout abort', async () => {
    setAuthConfig(65535);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    await runCli([
      'email',
      'send',
      '--agent',
      'agent_1',
      '--to',
      'a@example.com',
      '--subject',
      'S',
      '--body',
      'B',
    ]);

    globalThis.fetch = originalFetch;
    process.exit = originalExit;
    console.error = originalError;

    expect(String(firstCallArg(errorSpy) ?? '')).toContain('Failed to send email: Request timed out');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test.serial('email commands are registered in help output', async () => {
    const email = program.commands.find((cmd) => cmd.name() === 'email');
    expect(email).toBeDefined();
    const subcommands = (email?.commands ?? []).map((cmd) => cmd.name());
    expect(subcommands).toContain('send');
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('get');
    expect(subcommands).toContain('domains');
  });

  test.serial('auth config file can be created for email tests', () => {
    setAuthConfig(12345);
    const authPath = join(testConfigDir, 'auth.json');
    expect(existsSync(authPath)).toBe(true);
    const saved = JSON.parse(readFileSync(authPath, 'utf-8')) as { token: string };
    expect(saved.token).toBe('test-token');
  });
});
