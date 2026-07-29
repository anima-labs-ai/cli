/**
 * Intent tests for `--agent` falling back to the configured default identity.
 *
 * `am init` finishes by telling you to run
 * `am email send --to … --subject … --body …`, and that command failed with
 * `error: required option '--agent <id>' not specified` — the very first thing
 * onboarding asks a new user to do. The agent id was not missing: init had
 * just written `defaultIdentity` into config.json, `resolveConfigValue` had
 * layered lookup for it (flag > env > profile > global), and `config list`
 * printed it. Nothing ever *read* it. `defaultIdentity` was a write-only
 * field, and 17 commands demanded on the command line an id the CLI already
 * had on disk.
 *
 * `.requiredOption()` is why no amount of care inside an action body could fix
 * it: Commander rejects a mandatory option during *parse*, before `.action()`
 * runs, so the fallback has to live in the option's declaration, not its use.
 *
 * The sweep below is the part that keeps this fixed. A future command that
 * takes `--agent` is forced to declare which kind of agent it means, because
 * an unclassified one fails the test — the same "make the omission
 * unwritable" tactic the empty-id sweep in arg-validation.test.ts uses.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { InvalidArgumentError } from 'commander';
import type { Command, Option } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';

const testConfigDir = join(import.meta.dir, '.test-agent-default-config');

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

const CONFIGURED_AGENT = 'cms5z7mfm00d6s6014danhnao';

/**
 * Commands whose `--agent` names *the agent you are acting as*, and which used
 * to demand it on the command line. Omitting it now means "the one I
 * configured", so these resolve from `defaultIdentity`.
 */
const ACTS_AS_SELF: readonly string[] = [
  'identity card --agent <id>',
  'identity did --agent <id>',
  'identity credentials --agent <id>',
  'a2a tasks --agent <id>',
  'address validate --agent <agentId>',
  'address list --agent <id>',
  'address create --agent <id>',
  'phone list --agent <id>',
  'phone send-sms --agent <id>',
  'phone provision --agent <id>',
  'phone release --agent <id>',
  'email send --agent <id>',
  'email draft create --agent <id>',
  'vault provision --agent <id>',
  'vault deprovision --agent <id>',
  'vault share create --agent <id>',
  'registry register --agent-id <id>',
];

/**
 * Commands whose `--agent` names *somebody else*. These must stay mandatory:
 * defaulting a target to your own identity turns "submit this task to agent X"
 * into "submit it to myself" — silently, with an exit code of 0.
 *
 * Stated as the complete list of mandatory `--agent` options in the CLI rather
 * than as a property of these two commands, so the invariant has teeth: a new
 * `.requiredOption('--agent …')` anywhere fails this test and has to argue for
 * itself, which is how the 17 above accumulated unnoticed in the first place.
 */
const EXPLICIT_TARGET: readonly string[] = ['a2a send --agent <id>'];

/**
 * The other ~33 `--agent` options were already optional before any of this,
 * and are deliberately left alone. Their help text says why — "Agent ID
 * (optional with agent API key)" — the server infers the agent from an
 * agent-scoped key, so an absent value is already meaningful. Filling it from
 * `defaultIdentity` would start sending an explicit id that can disagree with
 * the key actually authenticating the call, which is the same
 * acting-as-the-wrong-agent bug this change exists to prevent, only quieter.
 *
 * `vault share list` / `revoke` are in this group for a second reason: their
 * absent `--agent` means "every share", not "mine".
 */

interface AgentOption {
  label: string;
  mandatory: boolean;
  guarded: boolean;
}

/** Same question arg-validation.test.ts asks: does this input reject `""`? */
function rejectsEmpty(parseArg: unknown): boolean {
  if (typeof parseArg !== 'function') return false;
  try {
    (parseArg as (value: string, previous?: unknown) => unknown)('', undefined);
    return false;
  } catch (error: unknown) {
    return error instanceof InvalidArgumentError;
  }
}

/** `trail` is the command path below the root, so labels read as typed. */
function collectAgentOptions(cmd: Command, trail: string[] = []): AgentOption[] {
  const found: AgentOption[] = [];

  for (const opt of cmd.options as readonly Option[]) {
    if (/^--agent(-id)? /.test(`${opt.flags} `)) {
      found.push({
        label: [...trail, opt.flags].join(' '),
        mandatory: opt.mandatory,
        guarded: rejectsEmpty(opt.parseArg),
      });
    }
  }

  for (const sub of cmd.commands) found.push(...collectAgentOptions(sub, [...trail, sub.name()]));
  return found;
}

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let program: Command;
let requestBodies: Array<{ path: string; body: unknown }> = [];

function writeConfig(config: Record<string, unknown>): void {
  writeFileSync(join(testConfigDir, 'config.json'), JSON.stringify(config));
}

describe('--agent defaults to the configured identity', () => {
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

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        let body: unknown = null;
        try {
          body = await req.json();
        } catch {
          body = null;
        }
        requestBodies.push({ path, body });
        return new Response(JSON.stringify({ id: 'msg_1', status: 'sent' }), {
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
    requestBodies = [];
    delete process.env.ANIMA_DEFAULT_IDENTITY;
    if (existsSync(testConfigDir)) rmSync(testConfigDir, { recursive: true, force: true });
  });

  test('the only mandatory --agent options are the ones naming another agent', () => {
    const options = collectAgentOptions(program);

    // Guard the guard: an empty sweep would pass every assertion below while
    // checking nothing at all. 50 --agent options across the CLI today.
    expect(options.length).toBeGreaterThan(40);

    const mandatory = options.filter((o) => o.mandatory).map((o) => o.label).sort();
    expect(mandatory).toEqual([...EXPLICIT_TARGET].sort());
  });

  test('every acting-as-self --agent is optional, so config can supply it', () => {
    const byLabel = new Map(collectAgentOptions(program).map((o) => [o.label, o.mandatory]));

    // Each label must actually exist — a renamed command would otherwise drop
    // out of the list and take its coverage with it, silently.
    const missing = ACTS_AS_SELF.filter((label) => !byLabel.has(label));
    expect(missing).toEqual([]);

    const stillMandatory = ACTS_AS_SELF.filter((label) => byLabel.get(label) === true);
    expect(stillMandatory).toEqual([]);
  });

  /**
   * Coverage that used to live in arg-validation.test.ts, which only sweeps
   * *mandatory* id options — these 17 left that sweep the moment they became
   * optional. Becoming optional is permission to omit the flag, not permission
   * to pass it empty: `--agent "$AGENT"` with an unset `AGENT` must still be a
   * usage error rather than a silent fall back to the configured identity,
   * which would send as an agent the command line appeared to override.
   */
  test('every acting-as-self --agent still rejects an explicit empty value', () => {
    const byLabel = new Map(collectAgentOptions(program).map((o) => [o.label, o.guarded]));

    const unguarded = ACTS_AS_SELF.filter((label) => byLabel.get(label) !== true);
    expect(unguarded).toEqual([]);
  });

  test('email send with no --agent sends as the configured defaultIdentity', async () => {
    writeConfig({ defaultIdentity: CONFIGURED_AGENT });

    await program.parseAsync(
      ['email', 'send', '--to', 'friend@example.com', '--subject', 'Hi', '--body', 'I am alive'],
      { from: 'user' },
    );

    const sent = requestBodies.find((r) => r.body !== null);
    expect(sent).toBeDefined();
    expect((sent?.body as { agentId?: string }).agentId).toBe(CONFIGURED_AGENT);
  });

  test('an explicit --agent still wins over the configured default', async () => {
    writeConfig({ defaultIdentity: CONFIGURED_AGENT });

    await program.parseAsync(
      [
        'email', 'send',
        '--agent', 'explicit-agent-id',
        '--to', 'friend@example.com',
        '--subject', 'Hi',
        '--body', 'I am alive',
      ],
      { from: 'user' },
    );

    const sent = requestBodies.find((r) => r.body !== null);
    expect((sent?.body as { agentId?: string }).agentId).toBe('explicit-agent-id');
  });

  test('ANIMA_DEFAULT_IDENTITY outranks the config file', async () => {
    writeConfig({ defaultIdentity: CONFIGURED_AGENT });
    process.env.ANIMA_DEFAULT_IDENTITY = 'env-agent-id';

    await program.parseAsync(
      ['email', 'send', '--to', 'friend@example.com', '--subject', 'Hi', '--body', 'I am alive'],
      { from: 'user' },
    );

    const sent = requestBodies.find((r) => r.body !== null);
    expect((sent?.body as { agentId?: string }).agentId).toBe('env-agent-id');
  });

  test('an explicitly empty --agent is still a usage error, not a fallback', async () => {
    writeConfig({ defaultIdentity: CONFIGURED_AGENT });

    // `--agent ""` is a value the user supplied and got wrong (a "$AGENT" that
    // expanded to nothing). Quietly substituting the configured default would
    // send as an identity the command line appeared to override.
    let threw = false;
    try {
      await program.parseAsync(
        ['email', 'send', '--agent', '', '--to', 'f@example.com', '--subject', 'Hi', '--body', 'x'],
        { from: 'user' },
      );
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    expect(requestBodies.filter((r) => r.body !== null)).toEqual([]);
  });
});
