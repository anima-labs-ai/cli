/**
 * The elevated credential has to reach the wire.
 *
 * `withElevation` holding a key in process memory and `withAutoElevation`
 * retrying are each testable on their own, and both were — while the whole
 * thing did nothing. Nothing read the holder, so the retry went out under the
 * same unprivileged key the server had just refused, and the user paid a
 * password dialog for a second identical 403. Every unit test still passed:
 * the key was held, the retry did happen, and no assertion looked at what was
 * actually sent.
 *
 * So these run the real chain end to end — `createOrpcClient` → `OpenAPILink` →
 * `ensureAuthHeaders` → a real HTTP server — and assert on the `Authorization`
 * header the server received. The server authorises on that header rather than
 * counting calls, so a retry under the wrong credential fails the way it would
 * in production instead of passing on a fixture's goodwill.
 *
 * Only the step-up exchange is stubbed. Minting the key needs a keychain, an
 * OS password dialog and an API; none of that is what this file is about, and
 * `withAutoElevation` takes the injection point for exactly this reason.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-elevated-credential-config');

mock.module('env-paths', () => ({
  default: () => ({
    config: testConfigDir,
    data: testConfigDir,
    cache: testConfigDir,
    log: testConfigDir,
    temp: testConfigDir,
  }),
}));

import type { GlobalOptions } from '../../lib/auth.js';
import type { ElevatedSession } from '../../lib/elevation.js';

const config = await import('../../lib/config.js');
const orpc = await import('../../lib/orpc.js');

/** The key `am init` stores: enough to send as the agent, not to administer. */
const AGENT_KEY = 'ak_agent_unprivileged';
/** What the step-up mints. Distinctive so a header assertion cannot be ambiguous. */
const MASTER_KEY = 'mk_elevated_for_one_call';

const SESSION: ElevatedSession = {
  apiKey: MASTER_KEY,
  apiKeyId: 'akid_elevated',
  expiresAt: '2999-01-01T00:00:00.000Z',
};

const AGENTS = { agents: [{ id: 'agent_1', name: 'shopping-agent' }], total: 1 };

let server: ReturnType<typeof Bun.serve> | null = null;
/** Every `Authorization` header the server saw, in order. */
let seenAuth: string[] = [];

/**
 * A server that gates on the credential, the way the real one does.
 *
 * Deliberately not "403 the first call, 200 the second": that shape passes
 * whatever the retry sends, which is precisely the bug this file exists for.
 */
function startServer(): string {
  const listener = Bun.serve({
    port: 0,
    fetch(request) {
      seenAuth.push(request.headers.get('authorization') ?? '');
      if (request.headers.get('authorization') !== `Bearer ${MASTER_KEY}`) {
        return new Response(
          JSON.stringify({
            error: { code: 'MASTER_KEY_REQUIRED', message: 'Master key required.' },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(AGENTS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  server = listener;
  // `.url`, not `.port`: the latter is `number | undefined` on Bun's socket-or-
  // port union, and the origin is what the caller actually needs.
  return listener.url.origin;
}

describe('an in-flight elevation reaches the wire', () => {
  let opts: GlobalOptions;

  beforeEach(async () => {
    config.resetPathsCache();
    config.setPathsOverride({
      config: testConfigDir,
      data: testConfigDir,
      cache: testConfigDir,
      log: testConfigDir,
      temp: testConfigDir,
    });
    if (!existsSync(testConfigDir)) mkdirSync(testConfigDir, { recursive: true });

    seenAuth = [];
    const apiUrl = startServer();
    await config.saveAuthConfig({ apiUrl, apiKey: AGENT_KEY });
    opts = { apiUrl } as GlobalOptions;
  });

  afterEach(() => {
    server?.stop(true);
    server = null;
    delete process.env.ANIMA_API_KEY;
    config.resetPathsCache();
    if (existsSync(testConfigDir)) rmSync(testConfigDir, { recursive: true, force: true });
  });

  /** The wrapped client `requireOrpcAuth` builds, with the step-up stubbed. */
  function client(elevate: () => Promise<ElevatedSession | null> = async () => SESSION) {
    return orpc.withAutoElevation(orpc.createOrpcClient(opts), opts, elevate);
  }

  test('a master-gated call 403s, elevates, and the retry succeeds under the new key', async () => {
    const result = await client().agent.list({});

    // The call has to actually come back with the server's data. Anything less
    // and "elevation worked" is only a claim about local state.
    expect(result).toEqual(AGENTS as never);

    expect(seenAuth).toEqual([`Bearer ${AGENT_KEY}`, `Bearer ${MASTER_KEY}`]);
  });

  test('the window closes with the call — the next request is unprivileged again', async () => {
    await client().agent.list({});

    // A second command on the same process must start from scratch. If the key
    // outlived the call, every later request would inherit master authority,
    // which is the standing window this design removes.
    await expect(client(async () => null).agent.list({})).rejects.toThrow('Master key required');
    expect(seenAuth[2]).toBe(`Bearer ${AGENT_KEY}`);
  });

  test('the elevated key outranks ANIMA_API_KEY', async () => {
    // The env var wins over every stored credential, by design. It must not win
    // over an elevation: the step-up happened *because* whatever this resolves
    // to was refused, so preferring it would send the retry out under the key
    // the server has already rejected — auto-elevation silently inert for
    // exactly the callers who set it, which is most agents and every CI job.
    process.env.ANIMA_API_KEY = 'ak_from_the_environment';

    const result = await client().agent.list({});

    expect(result).toEqual(AGENTS as never);
    expect(seenAuth).toEqual(['Bearer ak_from_the_environment', `Bearer ${MASTER_KEY}`]);
  });

  test('an unelevatable caller sends the ordinary key once and gets the refusal', async () => {
    // Not enrolled, no terminal, revoked grant — all arrive here as `null`. The
    // server's own MASTER_KEY_REQUIRED has to survive to the caller, and no
    // second request may go out pretending to be privileged.
    await expect(client(async () => null).agent.list({})).rejects.toThrow('Master key required');
    expect(seenAuth).toEqual([`Bearer ${AGENT_KEY}`]);
  });
});
