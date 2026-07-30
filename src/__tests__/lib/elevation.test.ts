/**
 * Owner grants — the storage half.
 *
 * The whole design rests on one claim: the grant sits somewhere the OS will not
 * hand back without a human. If it is ever written with an ordinary keychain
 * call, everything above it still works — enrolment succeeds, step-ups succeed,
 * no test of the happy path notices — and the gate is simply gone. So these
 * assert *how* it was stored, not merely that it round-trips.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-config-elevation');

mock.module('env-paths', () => ({
  default: () => ({
    config: testConfigDir,
    data: testConfigDir,
    cache: testConfigDir,
    log: testConfigDir,
    temp: testConfigDir,
  }),
}));

import type { InMemorySecureStore } from '../../lib/secure-store.js';

const config = await import('../../lib/config.js');
const secureStore = await import('../../lib/secure-store.js');
const elevation = await import('../../lib/elevation.js');

let memoryStore: InMemorySecureStore;

const ORG = 'org_test';
const GRANT_ACCOUNT = `grant:${ORG}`;
const FUTURE = '2999-01-01T00:00:00.000Z';

describe('owner grants', () => {
  beforeEach(() => {
    config.resetPathsCache();
    config.setPathsOverride({
      config: testConfigDir,
      data: testConfigDir,
      cache: testConfigDir,
      log: testConfigDir,
      temp: testConfigDir,
    });
    memoryStore = new secureStore.InMemorySecureStore();
    secureStore.setSecureStoreOverride(memoryStore);
    if (!existsSync(testConfigDir)) mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    secureStore.setSecureStoreOverride(null);
    if (existsSync(testConfigDir)) rmSync(testConfigDir, { recursive: true, force: true });
  });

  test('the grant is stored behind a human-presence gate, not an ordinary write', async () => {
    await elevation.recordEnrollment(ORG, 'sk_live_grant', FUTURE);

    // The assertion that matters. An ordinary `setSecret` would satisfy every
    // other test in this file while leaving the secret readable by anything
    // running as this user — which is the exact thing the grant must not be.
    expect(memoryStore.gatedAccounts.has(GRANT_ACCOUNT)).toBe(true);
    expect(await memoryStore.getSecret(GRANT_ACCOUNT)).toBe('sk_live_grant');
  });

  test('reading the grant re-arms the gate', async () => {
    await elevation.recordEnrollment(ORG, 'sk_live_grant', FUTURE);
    // Simulate the user clicking "Always Allow": the OS drops the gate on that
    // item and every later read would succeed silently.
    await memoryStore.setSecret(GRANT_ACCOUNT, 'sk_live_grant');
    expect(memoryStore.gatedAccounts.has(GRANT_ACCOUNT)).toBe(false);

    expect(await elevation.readGrant(ORG)).toBe('sk_live_grant');

    // Re-armed, so a mis-click costs one command rather than every future one.
    expect(memoryStore.gatedAccounts.has(GRANT_ACCOUNT)).toBe(true);
  });

  test('asking whether we are enrolled never touches the keychain', async () => {
    await elevation.recordEnrollment(ORG, 'sk_live_grant', FUTURE);

    let reads = 0;
    const realGet = memoryStore.getSecret.bind(memoryStore);
    memoryStore.getSecret = async (account: string) => {
      reads += 1;
      return realGet(account);
    };

    expect(await elevation.enrollmentFor(ORG)).toBeDefined();

    // Reading the grant is what raises the password dialog. If the enrolment
    // check reached for it, merely deciding whether a prompt is warranted
    // would raise one — including when the answer is "not enrolled".
    expect(reads).toBe(0);
  });

  test('a backend with no gate refuses to hold a grant rather than pretend', async () => {
    memoryStore.humanPresenceGate = false;

    await expect(elevation.recordEnrollment(ORG, 'sk_live_grant', FUTURE)).rejects.toThrow();

    // And leaves no marker behind: a marker without a secret would send every
    // later step-up looking for something that was never stored.
    expect(await elevation.enrollmentFor(ORG)).toBeUndefined();
  });

  test('forgetting an enrolment clears both the secret and the marker', async () => {
    await elevation.recordEnrollment(ORG, 'sk_live_grant', FUTURE);
    await elevation.forgetEnrollment(ORG);

    expect(await elevation.enrollmentFor(ORG)).toBeUndefined();
    expect(await memoryStore.getSecret(GRANT_ACCOUNT)).toBeNull();
  });

  test('canHoldGrant reports the backend capability, not the platform', async () => {
    expect(elevation.canHoldGrant()).toBe(true);
    memoryStore.humanPresenceGate = false;
    expect(elevation.canHoldGrant()).toBe(false);
  });

  describe('live session', () => {
    async function withSession(expiresAt: string | undefined) {
      await config.saveConfig({
        defaultOrg: ORG,
        activeProfile: elevation.elevatedProfileName(ORG),
        profiles: {
          [elevation.elevatedProfileName(ORG)]: { apiKey: 'sk_live_session', expiresAt },
        },
      });
    }

    test('an unexpired elevated profile counts as live', async () => {
      await withSession(FUTURE);
      expect(await elevation.hasLiveSession()).toBe(true);
    });

    test('an expired one does not', async () => {
      await withSession('2020-01-01T00:00:00.000Z');
      // This is what stops auto-elevation short-circuiting on a dead session
      // and reporting a permissions error the user could have fixed.
      expect(await elevation.hasLiveSession()).toBe(false);
    });

    test('an ordinary profile is not a privileged session', async () => {
      await config.saveConfig({
        defaultOrg: ORG,
        activeProfile: 'work',
        profiles: { work: { apiKey: 'ak_agent' } },
      });
      expect(await elevation.hasLiveSession()).toBe(false);
    });
  });
});
