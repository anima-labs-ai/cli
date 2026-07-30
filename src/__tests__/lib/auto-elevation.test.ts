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
import { ORPCError, type AnimaClient, withAutoElevation } from '../../lib/orpc.js';

const OPTS = {} as GlobalOptions;

function masterRequired(): ORPCError<string, unknown> {
  return new ORPCError('MASTER_KEY_REQUIRED', { status: 403, message: 'Master key required' });
}

/** A stand-in for the contract client: nested namespaces, callable leaves. */
function fakeClient(create: () => Promise<unknown>) {
  return { agent: { create } } as unknown as AnimaClient;
}

describe('withAutoElevation', () => {
  test('elevates once and retries when the server demands master', async () => {
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      if (calls === 1) throw masterRequired();
      return { id: 'agent_1' };
    });

    let elevations = 0;
    const wrapped = withAutoElevation(client, OPTS, async () => {
      elevations += 1;
      return true;
    });

    expect(await wrapped.agent.create({} as never)).toEqual({ id: 'agent_1' } as never);
    expect(calls).toBe(2);
    expect(elevations).toBe(1);
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
      return true;
    });

    await expect(wrapped.agent.create({} as never)).rejects.toThrow('Master key required');
    // Two attempts, one step-up. If the retry re-entered the wrapper this
    // would climb until the stack or the user's patience gave out.
    expect(calls).toBe(2);
    expect(elevations).toBe(1);
  });

  test('when elevation is unavailable the original error surfaces', async () => {
    const client = fakeClient(async () => {
      throw masterRequired();
    });
    // Not enrolled, grant revoked, no keychain — all report false.
    const wrapped = withAutoElevation(client, OPTS, async () => false);

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
      return true;
    });

    await expect(wrapped.agent.create({} as never)).rejects.toThrow('No such agent');
    // A 404 is not an authorisation problem; prompting for a password here
    // would train users to type it at unrelated failures.
    expect(elevations).toBe(0);
  });

  test('a successful call never elevates', async () => {
    const client = fakeClient(async () => ({ id: 'agent_1' }));
    let elevations = 0;
    const wrapped = withAutoElevation(client, OPTS, async () => {
      elevations += 1;
      return true;
    });

    expect(await wrapped.agent.create({} as never)).toEqual({ id: 'agent_1' } as never);
    expect(elevations).toBe(0);
  });
});
