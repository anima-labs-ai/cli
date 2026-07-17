/**
 * Intent tests for empty-id rejection across every command that names a
 * resource by id.
 *
 * Commander rejects a *missing* `<id>`, but an empty string counts as
 * supplied and reaches the action. It then collapses the request path —
 * `/webhooks/{id}` becomes `/webhooks/`, which the API resolves to the LIST
 * route and answers 200 with a list payload. The command renders that as a
 * single resource and dies on a missing field, reporting the TypeError as
 * "Failed to get webhook: …" — the API blamed for a usage mistake. Worse,
 * `delete`/`send` shaped commands reported success for an id that never
 * existed ("Deleted draft undefined", exit 0).
 *
 * `email draft` was added long after the commands it copied, and inherited
 * the same gap — so the structural test below is the real guard: it fails
 * for any *future* `<id>` argument that forgets the parser.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Argument, Command, CommanderError } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-arg-validation-config');

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

// An argument that names a resource by id: `<id>`, `<callId>`,
// `<credentialId>`, `<requestId>`, `<addressId>`, `<orgId>`. There is no
// such thing as a meaningful empty id, so every one of these must be
// guarded. Args like `<value>`, `<query>` or `<kind>` are deliberately out
// of scope — an empty value can be legitimate, or is already validated
// against an allowlist with a better message.
const ID_ARGUMENT = /^id$|Id$/;

interface IdArg {
  command: string;
  arg: string;
  guarded: boolean;
}

function collectIdArguments(cmd: Command, trail: string[] = []): IdArg[] {
  const here = [...trail, cmd.name()];
  const found: IdArg[] = [];

  for (const arg of cmd.registeredArguments as readonly Argument[]) {
    if (arg.required && ID_ARGUMENT.test(arg.name())) {
      found.push({
        command: here.join(' '),
        arg: arg.name(),
        guarded: typeof arg.parseArg === 'function',
      });
    }
  }

  for (const sub of cmd.commands) found.push(...collectIdArguments(sub, here));
  return found;
}

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let program: Command;
const requests: string[] = [];

describe('empty id arguments', () => {
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
    if (!existsSync(testConfigDir)) mkdirSync(testConfigDir, { recursive: true });

    // A real server plus real auth config, so an *unguarded* command would
    // genuinely reach the network — otherwise "no request was issued" would
    // pass for the wrong reason (auth failing first).
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(`${req.method} ${new URL(req.url).pathname}`);
        return new Response(JSON.stringify({ items: [], hasMore: false, nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    mockServer = server;
    writeFileSync(
      join(testConfigDir, 'auth.json'),
      JSON.stringify({ token: 'test-token', apiUrl: `http://localhost:${server.port}` }),
    );
  });

  afterEach(() => {
    mockServer?.stop();
    mockServer = null;
    requests.length = 0;
    if (existsSync(testConfigDir)) rmSync(testConfigDir, { recursive: true, force: true });
  });

  test('every required id argument in the CLI is guarded against an empty value', () => {
    const idArgs = collectIdArguments(program);

    // Guard the guard: if this ever reads 0, the pattern stopped matching and
    // the assertion below would pass while checking nothing.
    expect(idArgs.length).toBeGreaterThan(20);

    const unguarded = idArgs.filter((a) => !a.guarded).map((a) => `${a.command} <${a.arg}>`);
    expect(unguarded).toEqual([]);
  });

  // A cross-section: read/destructive/nested, oRPC and legacy api-client, and
  // the one id command that also carries a required option.
  const CASES: Array<{ argv: string[]; label: string }> = [
    { label: 'webhook get', argv: ['webhook', 'get', ''] },
    { label: 'webhook delete', argv: ['webhook', 'delete', ''] },
    { label: 'inbox delete', argv: ['inbox', 'delete', ''] },
    { label: 'message get', argv: ['message', 'get', ''] },
    { label: 'email get', argv: ['email', 'get', ''] },
    { label: 'email domains delete', argv: ['email', 'domains', 'delete', ''] },
    { label: 'voice transcript', argv: ['voice', 'transcript', ''] },
    { label: 'vault get', argv: ['vault', 'get', ''] },
    { label: 'vault request cancel', argv: ['vault', 'request', 'cancel', ''] },
    { label: 'org switch', argv: ['org', 'switch', ''] },
    { label: 'address validate', argv: ['address', 'validate', '', '--agent', 'agt_1'] },
  ];

  for (const { argv, label } of CASES) {
    test(`${label} rejects an empty id as a usage error before any request`, async () => {
      const logSpy = mock(() => {});
      const originalLog = console.log;
      const originalError = console.error;
      const originalExit = process.exit;
      const originalWriteErr = process.stderr.write;
      console.log = logSpy;
      console.error = mock(() => {}) as unknown as typeof console.error;
      process.exit = mock(() => {}) as unknown as typeof process.exit;
      process.stderr.write = (() => true) as typeof process.stderr.write;

      let thrown: unknown;
      try {
        await program.parseAsync(['node', 'anima', ...argv]);
      } catch (error: unknown) {
        thrown = error;
      }

      console.log = originalLog;
      console.error = originalError;
      process.exit = originalExit;
      process.stderr.write = originalWriteErr;

      // Reported as the usage mistake it is — same shape as a missing `<id>`.
      expect((thrown as CommanderError | undefined)?.code).toBe('commander.invalidArgument');
      expect(String((thrown as Error | undefined)?.message)).toMatch(/cannot be empty/i);

      // The empty id never left the CLI, so the API is never blamed for it.
      expect(requests).toEqual([]);

      // And nothing was dressed up as a success.
      const stdout = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
      expect(stdout).not.toContain('success');
    });
  }
});
