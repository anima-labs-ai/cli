import { mock } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Command } from 'commander';
import { createProgram } from '../../cli.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';

export interface MockServerContext {
  request: Request;
  url: URL;
  method: string;
  path: string;
  query: URLSearchParams;
  bodyText: string;
  body: unknown;
}

export interface MockRouteResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type MockRouteHandler = (ctx: MockServerContext) => Response | MockRouteResponse | Promise<Response | MockRouteResponse>;

export interface CapturedOutput {
  logs: string[];
  errors: string[];
  stdout: string[];
  stderr: string[];
  restore: () => void;
}

export interface TestContext {
  program: Command;
  configDir: string;
  mockServer: ReturnType<typeof Bun.serve> | null;
  cleanup: () => void;
  captureOutput: () => CapturedOutput;
}

function toOutputLine(args: unknown[]): string {
  return args.map((arg) => String(arg)).join(' ');
}

function parseRequestBody(bodyText: string, contentType: string): unknown {
  if (bodyText.length === 0) {
    return undefined;
  }
  if (!contentType.includes('application/json')) {
    return bodyText;
  }

  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return bodyText;
  }
}

function toResponse(value: Response | MockRouteResponse): Response {
  if (value instanceof Response) {
    return value;
  }

  const status = value.status ?? 200;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(value.headers ?? {}),
  };

  if (status === 204) {
    return new Response(null, { status, headers });
  }

  return new Response(JSON.stringify(value.body ?? {}), {
    status,
    headers,
  });
}

export function createMockServer(handlers: Record<string, MockRouteHandler>): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      const path = url.pathname;
      const key = `${method} ${path}`;
      const route = handlers[key];

      if (!route) {
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `No route for ${key}` } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const bodyText = method === 'GET' || method === 'HEAD' ? '' : await request.text();
      const body = parseRequestBody(bodyText, request.headers.get('content-type') ?? '');

      const response = await route({
        request,
        url,
        method,
        path,
        query: url.searchParams,
        bodyText,
        body,
      });

      return toResponse(response);
    },
  });
}

export function captureOutput(): CapturedOutput {
  const logs: string[] = [];
  const errors: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  const logSpy = mock((...args: unknown[]) => {
    logs.push(toOutputLine(args));
  });
  const errorSpy = mock((...args: unknown[]) => {
    errors.push(toOutputLine(args));
  });

  const stdoutSpy = mock((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  const stderrSpy = mock((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });

  console.log = logSpy;
  console.error = errorSpy;
  process.stdout.write = stdoutSpy as unknown as typeof process.stdout.write;
  process.stderr.write = stderrSpy as unknown as typeof process.stderr.write;

  return {
    logs,
    errors,
    stdout,
    stderr,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    },
  };
}

export function createTestContext(): TestContext {
  const configDir = join(tmpdir(), `am-cli-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  resetPathsCache();
  mkdirSync(configDir, { recursive: true });
  setPathsOverride({
    config: configDir,
    data: configDir,
    cache: configDir,
    log: configDir,
    temp: configDir,
  });

  const context: TestContext = {
    program: createProgram(),
    configDir,
    mockServer: null,
    cleanup: () => {
      context.mockServer?.stop();
      context.mockServer = null;
      resetPathsCache();
      rmSync(configDir, { recursive: true, force: true });
    },
    captureOutput,
  };

  return context;
}
