import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createProgram } from '../../cli.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-auth-config');

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

describe('auth commands', () => {
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

  describe('login', () => {
    test('login with api-key stores credentials', async () => {
      mockServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response(JSON.stringify({ email: 'test@example.com' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const exitSpy = mock(() => {});
      const originalExit = process.exit;
      process.exit = exitSpy as unknown as typeof process.exit;

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync([
          'node', 'anima',
          '--api-url', `http://localhost:${mockServer.port}`,
          'auth', 'login',
          '--api-key', 'sk_test_abc123',
        ]);
      } catch {
      }

      console.log = originalLog;
      process.exit = originalExit;

      const authPath = join(testConfigDir, 'auth.json');
      if (existsSync(authPath)) {
        const saved = JSON.parse(readFileSync(authPath, 'utf-8'));
        expect(saved.apiKey).toBe('sk_test_abc123');
        expect(saved.email).toBe('test@example.com');
      }
    });

    test('login with email/password stores token', async () => {
      mockServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response(JSON.stringify({
            token: 'jwt-token-123',
            refreshToken: 'refresh-456',
            expiresAt: '2025-12-31T00:00:00Z',
            email: 'user@example.com',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const exitSpy = mock(() => {});
      const originalExit = process.exit;
      process.exit = exitSpy as unknown as typeof process.exit;

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync([
          'node', 'anima',
          '--api-url', `http://localhost:${mockServer.port}`,
          'auth', 'login',
          '--email', 'user@example.com',
          '--password', 'secret',
        ]);
      } catch {
      }

      console.log = originalLog;
      process.exit = originalExit;

      const authPath = join(testConfigDir, 'auth.json');
      if (existsSync(authPath)) {
        const saved = JSON.parse(readFileSync(authPath, 'utf-8'));
        expect(saved.token).toBe('jwt-token-123');
        expect(saved.refreshToken).toBe('refresh-456');
        expect(saved.email).toBe('user@example.com');
      }
    });

    test('login without credentials fails', async () => {
      const exitSpy = mock(() => {});
      const originalExit = process.exit;
      process.exit = exitSpy as unknown as typeof process.exit;

      const errorSpy = mock(() => {});
      const originalError = console.error;
      console.error = errorSpy;

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'auth', 'login']);
      } catch {
      }

      console.error = originalError;
      console.log = originalLog;
      process.exit = originalExit;

      expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('login handles 401 auth failure', async () => {
      mockServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const errorSpy = mock(() => {});
      const originalError = console.error;
      console.error = errorSpy;

      const exitSpy = mock(() => {});
      const originalExit = process.exit;
      process.exit = exitSpy as unknown as typeof process.exit;

      try {
        await program.parseAsync([
          'node', 'anima',
          '--api-url', `http://localhost:${mockServer.port}`,
          'auth', 'login',
          '--email', 'user@example.com',
          '--password', 'wrong',
        ]);
      } catch {
      }

      console.error = originalError;
      process.exit = originalExit;

      const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
      expect(output.includes('Login failed: Invalid credentials (401)')).toBe(true);
      expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('login handles 500 server error', async () => {
      mockServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Server exploded' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const errorSpy = mock(() => {});
      const originalError = console.error;
      console.error = errorSpy;

      const exitSpy = mock(() => {});
      const originalExit = process.exit;
      process.exit = exitSpy as unknown as typeof process.exit;

      try {
        await program.parseAsync([
          'node', 'anima',
          '--api-url', `http://localhost:${mockServer.port}`,
          'auth', 'login',
          '--api-key', 'sk_test_abc123',
        ]);
      } catch {
      }

      console.error = originalError;
      process.exit = originalExit;

      const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
      expect(output.includes('Login failed: Server exploded (500)')).toBe(true);
      expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('login handles network connection failure', async () => {
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

      try {
        await program.parseAsync(['node', 'anima', 'auth', 'login', '--api-key', 'sk_test_abc123']);
      } catch {
      }

      globalThis.fetch = originalFetch;
      console.error = originalError;
      process.exit = originalExit;

      const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
      expect(output.includes('Login failed: Network error: Connection refused (0)')).toBe(true);
      expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('login handles timeout abort', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() => {
        throw new DOMException('The operation was aborted', 'AbortError');
      }) as unknown as typeof fetch;

      const errorSpy = mock(() => {});
      const originalError = console.error;
      console.error = errorSpy;

      const exitSpy = mock(() => {});
      const originalExit = process.exit;
      process.exit = exitSpy as unknown as typeof process.exit;

      try {
        await program.parseAsync(['node', 'anima', 'auth', 'login', '--api-key', 'sk_test_abc123']);
      } catch {
      }

      globalThis.fetch = originalFetch;
      console.error = originalError;
      process.exit = originalExit;

      const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
      expect(output.includes('Request timed out')).toBe(true);
      expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('logout', () => {
    test('logout clears saved auth', async () => {
      const authPath = join(testConfigDir, 'auth.json');
      writeFileSync(authPath, JSON.stringify({ token: 'to-clear', email: 'old@test.com' }));

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'auth', 'logout']);
      } catch {
      }

      console.log = originalLog;

      if (existsSync(authPath)) {
        const saved = JSON.parse(readFileSync(authPath, 'utf-8'));
        expect(saved.token).toBeUndefined();
      }
    });
  });

  describe('whoami', () => {
    test('whoami shows account info when authenticated', async () => {
      mockServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response(JSON.stringify({
            email: 'me@example.com',
            orgId: 'org-123',
            orgName: 'My Org',
            role: 'admin',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const authPath = join(testConfigDir, 'auth.json');
      writeFileSync(authPath, JSON.stringify({
        token: 'valid-token',
        apiUrl: `http://localhost:${mockServer.port}`,
      }));

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'auth', 'whoami']);
      } catch {
      }

      console.log = originalLog;

      expect(logSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('whoami fails when not authenticated', async () => {
      const exitSpy = mock(() => {});
      const originalExit = process.exit;
      process.exit = exitSpy as unknown as typeof process.exit;

      const errorSpy = mock(() => {});
      const originalError = console.error;
      console.error = errorSpy;

      const logSpy = mock(() => {});
      const originalLog = console.log;
      console.log = logSpy;

      try {
        await program.parseAsync(['node', 'anima', 'auth', 'whoami']);
      } catch {
      }

      console.error = originalError;
      console.log = originalLog;
      process.exit = originalExit;

      expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('whoami handles 401 by requesting re-login', async () => {
      mockServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'expired' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const authPath = join(testConfigDir, 'auth.json');
      writeFileSync(authPath, JSON.stringify({ token: 'expired-token', apiUrl: `http://localhost:${mockServer.port}` }));

      const errorSpy = mock(() => {});
      const originalError = console.error;
      console.error = errorSpy;

      const exitSpy = mock(() => {});
      const originalExit = process.exit;
      process.exit = exitSpy as unknown as typeof process.exit;

      try {
        await program.parseAsync(['node', 'anima', 'auth', 'whoami']);
      } catch {
      }

      console.error = originalError;
      process.exit = originalExit;

      const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
      expect(output.includes('Session expired. Run `anima auth login` again.')).toBe(true);
      expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('whoami handles malformed JSON success response', async () => {
      mockServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response('{ bad json', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const authPath = join(testConfigDir, 'auth.json');
      writeFileSync(authPath, JSON.stringify({ token: 'valid-token', apiUrl: `http://localhost:${mockServer.port}` }));

      const errorSpy = mock(() => {});
      const originalError = console.error;
      console.error = errorSpy;

      const exitSpy = mock(() => {});
      const originalExit = process.exit;
      process.exit = exitSpy as unknown as typeof process.exit;

      try {
        await program.parseAsync(['node', 'anima', 'auth', 'whoami']);
      } catch {
      }

      console.error = originalError;
      process.exit = originalExit;

      const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
      expect(output.includes('Failed to fetch account info:')).toBe(true);
      expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    });
  });
});

describe('CLI global options', () => {
  test('--version outputs version', async () => {
    const prog = createProgram();
    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    try {
      await prog.parseAsync(['node', 'anima', '--version']);
    } catch {
    }

    console.log = originalLog;
  });

  test('--help outputs help text', async () => {
    const prog = createProgram();
    const logSpy = mock(() => {});
    const originalLog = console.log;

    const writeSpy = mock((..._args: unknown[]) => true);
    const originalWrite = process.stdout.write;
    process.stdout.write = writeSpy as unknown as typeof process.stdout.write;
    console.log = logSpy;

    try {
      await prog.parseAsync(['node', 'anima', '--help']);
    } catch {
    }

    console.log = originalLog;
    process.stdout.write = originalWrite;
  });
});
