/**
 * Auto-elevation — the retry wrapper behind every master-gated command.
 *
 * It keys off the server's typed MASTER_KEY_REQUIRED rather than a list of
 * privileged commands, so the ~100 gated endpoints are covered by construction.
 * That leaves two things worth pinning down: it must retry exactly once (a
 * wrapper that re-entered itself would prompt for a password in a loop against
 * a server that has already refused), and it must not touch anything else.
 */

import { describe, expect, test } from 'bun:test';
import type { GlobalOptions } from '../../lib/auth.js';
import { type ElevatedSession, currentElevatedKey } from '../../lib/elevation.js';
import { ORPCError, type AnimaClient, withAutoElevation } from '../../lib/orpc.js';

const OPTS = {} as GlobalOptions;

/**
 * What a successful step-up now hands back.
 *
 * A boolean used to be enough because the credential went into a profile and
 * the retry picked it up from there. It is not enough now: the credential has
 * no home outside the retry, so it has to travel as a value.
 */
const SESSION: ElevatedSession = {
  apiKey: 'mk_elevated',
  apiKeyId: 'akid_elevated',
  expiresAt: '2999-01-01T00:00:00.000Z',
};

function masterRequired(): ORPCError<string, unknown> {
  return new ORPCError('MASTER_KEY_REQUIRED', { status: 403, message: 'Master key required' });
}

/** A stand-in for the contract client: nested namespaces, callable leaves. */
function fakeClient(create: () => Promise<unknown>) {
  return { agent: { create } } as unknown as AnimaClient;
}

/**
 * A stand-in for what oRPC actually hands us: a path-building Proxy where
 * *every* property access yields a callable, including `then`.
 *
 * The plain object above cannot reproduce the failure this guards, because a
 * plain object simply has no `then`. That is how the bug shipped: five green
 * tests against a fixture that was missing the one property that mattered.
 */
function pathProxyClient(onCall: (path: string[]) => Promise<unknown>): AnimaClient {
  const build = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get: (_t, prop) => (typeof prop === 'string' ? build([...path, prop]) : undefined),
      apply: () => onCall(path),
    });
  return build([]) as AnimaClient;
}

describe('withAutoElevation', () => {
  test('elevates once and retries when the server demands master', async () => {
    let calls = 0;
    let keyDuringRetry: string | undefined;
    const client = fakeClient(async () => {
      calls += 1;
      if (calls === 1) throw masterRequired();
      keyDuringRetry = currentElevatedKey();
      return { id: 'agent_1' };
    });

    let elevations = 0;
    const wrapped = withAutoElevation(client, OPTS, async () => {
      elevations += 1;
      return SESSION;
    });

    expect(await wrapped.agent.create({} as never)).toEqual({ id: 'agent_1' } as never);
    expect(calls).toBe(2);
    expect(elevations).toBe(1);

    // The retry has to happen *inside* the elevation window. Nothing else pins
    // this: the step-up no longer writes the credential anywhere, so a retry
    // issued outside the window would go out unprivileged and be refused
    // again, with the wrapper reporting success at having elevated.
    expect(keyDuringRetry).toBe(SESSION.apiKey);

    // And the window closes with the call. A key still live here is a key the
    // next command on this machine inherits.
    expect(currentElevatedKey()).toBeUndefined();
  });

  test('a second refusal is final — it does not prompt again', async () => {
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      throw masterRequired();
    });

    let elevations = 0;
    const wrapped = withAutoElevation(client, OPTS, async () => {
      elevations += 1;
      return SESSION;
    });

    await expect(wrapped.agent.create({} as never)).rejects.toThrow('Master key required');
    // Two attempts, one step-up. If the retry re-entered the wrapper this
    // would climb until the stack or the user's patience gave out.
    expect(calls).toBe(2);
    expect(elevations).toBe(1);

    // The refused retry must still have released the credential. This is the
    // path that matters most: a privileged command failing is the everyday way
    // a key would get stranded live for the rest of the process.
    expect(currentElevatedKey()).toBeUndefined();
  });

  test('when elevation is unavailable the original error surfaces', async () => {
    const client = fakeClient(async () => {
      throw masterRequired();
    });
    // Not enrolled, grant revoked, no keychain — all report null.
    const wrapped = withAutoElevation(client, OPTS, async () => null);

    // The server's own message reaches the user rather than a wrapper error
    // about elevation, because MASTER_KEY_REQUIRED already carries the fix.
    await expect(wrapped.agent.create({} as never)).rejects.toThrow('Master key required');
  });

  test('any other failure passes straight through, unelevated', async () => {
    const client = fakeClient(async () => {
      throw new ORPCError('NOT_FOUND', { status: 404, message: 'No such agent' });
    });

    let elevations = 0;
    const wrapped = withAutoElevation(client, OPTS, async () => {
      elevations += 1;
      return SESSION;
    });

    await expect(wrapped.agent.create({} as never)).rejects.toThrow('No such agent');
    // A 404 is not an authorisation problem; prompting for a password here
    // would train users to type it at unrelated failures.
    expect(elevations).toBe(0);
  });

  test('the wrapped client survives being awaited', async () => {
    // `requireOrpcAuth` is async and returns this proxy, so the async
    // machinery probes it for `.then` on every single command. Against oRPC's
    // path-building proxy that probe yields a callable, the wrapper turned it
    // into a plain async function, and JS then invoked it as a real thenable —
    // sending `then` down the wire as a procedure name. Every command died
    // with "expect a contract procedure at then.apply" before reaching the
    // network.
    const wrapped = withAutoElevation(
      pathProxyClient(async (path) => ({ path })),
      OPTS,
      async () => SESSION,
    );

    const resolved = await (async () => wrapped)();

    // Must resolve to the wrapper itself. Passing `then` through untouched
    // would also stop the crash, but oRPC's own guard resolves to *its*
    // client — auto-elevation would silently disappear instead.
    expect(await resolved.agent.create({} as never)).toEqual({
      path: ['agent', 'create'],
    } as never);
  });

  test('elevate-and-retry works against a path-building client too', async () => {
    // The same contract as the first test, but through the proxy shape oRPC
    // actually returns. Running it only against a plain object is what let a
    // wrapper that broke `orpc.agent.create` pass five tests.
    let calls = 0;
    const client = pathProxyClient(async (path) => {
      calls += 1;
      if (calls === 1) throw masterRequired();
      return { path };
    });

    let elevations = 0;
    const wrapped = withAutoElevation(client, OPTS, async () => {
      elevations += 1;
      return SESSION;
    });

    expect(await wrapped.agent.create({} as never)).toEqual({
      path: ['agent', 'create'],
    } as never);
    expect(calls).toBe(2);
    expect(elevations).toBe(1);
  });

  test('a successful call never elevates', async () => {
    const client = fakeClient(async () => ({ id: 'agent_1' }));
    let elevations = 0;
    const wrapped = withAutoElevation(client, OPTS, async () => {
      elevations += 1;
      return SESSION;
    });

    expect(await wrapped.agent.create({} as never)).toEqual({ id: 'agent_1' } as never);
    expect(elevations).toBe(0);
  });
});
