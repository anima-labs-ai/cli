/**
 * Intent tests for empty-id rejection across every input the CLI calls an id.
 *
 * Commander rejects a *missing* `<id>`, but an empty string counts as supplied
 * and reaches the action. It then collapses the request path — `/webhooks/{id}`
 * becomes `/webhooks/`, which the API resolves to the LIST route and answers
 * 200 with a list payload. Read commands render that as a single resource and
 * die on a missing field, surfacing the TypeError as "Failed to get webhook: …"
 * — the API blamed for a usage mistake. Destructive commands fail worse:
 * `identity delete --id ""` reported `Identity deleted: ` and exited 0 for a
 * delete that never happened.
 *
 * Ids arrive as options (`--id`, `--agent`, `--org`) at least as often as
 * positionals, and `email draft create --agent ""` is the same defect in the
 * very feature this started from — so both surfaces are covered here.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { InvalidArgumentError } from 'commander';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Argument, Command, CommanderError, Option } from 'commander';
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

/**
 * "The author called this thing an id" — asked two independent ways, because
 * either signal alone has a blind spot:
 *
 *   - The flag name can't be trusted: an id usually arrives as `--agent <id>`,
 *     whose attribute name is `agent`. A name-only rule sees 9 of the 36 id
 *     options and degenerates into a hand-maintained allowlist of
 *     `--agent`/`--org`/`--from`/`--key-id`/… — the same forgetting problem
 *     one level up.
 *   - The description can't be trusted either: `address validate --agent
 *     <agentId>` is described as "Agent that owns the address", which never
 *     says "ID" though every one of its 14 siblings does.
 *
 * So: the description says id/DID, OR the placeholder is id-shaped. They agree
 * on 61 of the 65 inputs; the 4 disagreements are exactly the cases above,
 * where one signal is weak and the other carries it.
 *
 * `\b` is load-bearing in the description rule — it keeps out "Task type
 * identifier", "Credential reference: cred_id or anima.json key", and the
 * config-key listing containing "defaultIdentity". None are ids.
 *
 * Deliberately out of scope: `<value>`, `<query>`, `<name>`, `--input <json>`,
 * `--vtk <vtk_token>`. An empty value there is a server-side or domain
 * question, not a usage error.
 */
const DESCRIBES_AN_ID = /\b(id|did)\b/i;
const PLACEHOLDER_IS_AN_ID = /^(id|did|.*Id)$/;

/** `'--agent <agentId>'` -> `'agentId'`; `'<callId>'` is already bare. */
function placeholderOf(flags: string): string {
  return flags.match(/<([^>]+)>/)?.[1] ?? '';
}

function namesAnId(description: string, placeholder: string): boolean {
  return DESCRIBES_AN_ID.test(description) || PLACEHOLDER_IS_AN_ID.test(placeholder);
}

/**
 * Does this input actually REJECT an empty value?
 *
 * Asserting that a parser merely *exists* would pass for any parser at all: a
 * future cuid-format checker or a case-normalizer that never considered empty
 * would read as guarded while staying live-buggy. Ask it the question instead.
 */
function rejectsEmpty(parseArg: unknown): boolean {
  if (typeof parseArg !== 'function') return false;
  try {
    (parseArg as (value: string, previous?: unknown) => unknown)('', undefined);
    return false;
  } catch (error: unknown) {
    return error instanceof InvalidArgumentError;
  }
}

interface IdInput {
  command: string;
  input: string;
  guarded: boolean;
}

function collectIdInputs(cmd: Command, trail: string[] = []): IdInput[] {
  const here = [...trail, cmd.name()];
  const found: IdInput[] = [];

  for (const arg of cmd.registeredArguments as readonly Argument[]) {
    if (arg.required && namesAnId(arg.description, arg.name())) {
      found.push({ command: here.join(' '), input: `<${arg.name()}>`, guarded: rejectsEmpty(arg.parseArg) });
    }
  }

  for (const opt of cmd.options as readonly Option[]) {
    if (opt.mandatory && namesAnId(opt.description, placeholderOf(opt.flags))) {
      found.push({ command: here.join(' '), input: opt.flags, guarded: rejectsEmpty(opt.parseArg) });
    }
  }

  for (const sub of cmd.commands) found.push(...collectIdInputs(sub, here));
  return found;
}

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let program: Command;
const requests: string[] = [];

describe('empty id inputs', () => {
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

  test('every required id input in the CLI — positional or option — rejects an empty value', () => {
    const inputs = collectIdInputs(program);
    const positionals = inputs.filter((i) => i.input.startsWith('<'));
    const options = inputs.filter((i) => i.input.startsWith('-'));

    // Guard the guard. Without these the assertion below passes while checking
    // nothing, which is how the first version of this test told the truth about
    // positionals and said nothing at all about options. 28/36 today.
    expect(positionals.length).toBeGreaterThan(20);
    expect(options.length).toBeGreaterThan(30);

    const unguarded = inputs.filter((i) => !i.guarded).map((i) => `${i.command} ${i.input}`);
    expect(unguarded).toEqual([]);
  });

  // A cross-section: positional and option, read and destructive, oRPC and
  // legacy api-client, top-level and deeply nested.
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
    // Options. `identity delete` is the one that reported a successful delete
    // for an id that was never sent; `email draft create` is the drafts feature
    // this all started from.
    { label: 'identity delete --id', argv: ['identity', 'delete', '--id', ''] },
    { label: 'identity get --id', argv: ['identity', 'get', '--id', ''] },
    { label: 'identity rotate-key --id', argv: ['identity', 'rotate-key', '--id', ''] },
    { label: 'email draft create --agent', argv: ['email', 'draft', 'create', '--agent', ''] },
    { label: 'admin usage --org', argv: ['admin', 'usage', '--org', ''] },
    { label: 'a2a tasks --agent', argv: ['a2a', 'tasks', '--agent', ''] },
    { label: 'registry lookup --did', argv: ['registry', 'lookup', '--did', ''] },
    { label: 'vault token create --credential', argv: ['vault', 'token', 'create', '--credential', ''] },
    // Both surfaces on one command: a good positional must not excuse an empty
    // option. The first version of this test passed `--agent agt_1` here and so
    // stepped straight around the gap it was sitting next to.
    { label: 'address validate <id>', argv: ['address', 'validate', '', '--agent', 'agt_1'] },
    { label: 'address validate --agent', argv: ['address', 'validate', 'addr_1', '--agent', ''] },
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
