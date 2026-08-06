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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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

    test('a session with no recorded expiry is dead, not eternal', async () => {
      await withSession(undefined);

      // The credential path already treats an expiry-less session profile as
      // lapsed — they were written by a CLI that did not record one, so their
      // 15-minute key is long dead. This has to agree, and for the opposite
      // reason to the expired case above: if it reported "live", the retry
      // logic would skip the step-up believing the failing request had already
      // gone out under a privileged key. It had not — the credential path
      // rejected this profile and sent the agent key — so the user would get a
      // bare MASTER_KEY_REQUIRED and no prompt, on every command, forever.
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

  /**
   * Ephemeral elevation — the credential lives for one call and no longer.
   *
   * The standing window is the thing being closed. Parking a privileged key in
   * a profile and marking it active hands master authority to *everything* that
   * runs `am` on this machine for the next hour — including an agent shelling
   * out, which can then read every vault secret and mint itself a permanent
   * master key via `apiKeys.create`. The human-presence dialog is not the leak;
   * persistence is. So these assert that the credential is reachable from
   * exactly one place — inside the callback — and from nowhere afterwards.
   */
  describe('ephemeral elevation', () => {
    // Distinctive on purpose: a canary that would be unmistakable in a config
    // file, so a substring search cannot collide with anything else on disk.
    const CANARY = 'mk_canary_must_never_persist_7f3a91';
    const SESSION = { apiKey: CANARY, apiKeyId: 'akid_canary', expiresAt: FUTURE };

    /**
     * Every byte this CLI can leave under its config dir, concatenated.
     *
     * Deliberately raw text rather than `getConfig()`: a getter only answers
     * for the shapes it knows about, and the requirement here is stronger than
     * "no elevated profile". The credential must not be in those files at all,
     * by any route — a stray top-level field, a profile under an unexpected
     * name, a half-written migration blob.
     */
    function configDirBytes(): string {
      return readdirSync(testConfigDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => readFileSync(join(testConfigDir, entry.name), 'utf8'))
        .join('\n');
    }

    /**
     * Record every secret written to the store from here on.
     *
     * The config-file assertion alone would not catch the route that matters.
     * `saveConfig` strips every profile `apiKey` out of the file and into the
     * secure store, so `activateSession` — the persistence being removed —
     * leaves the credential in the keychain and only its metadata in
     * config.json. A file-only check would call that clean.
     */
    function recordStoreWrites(): string[] {
      const written: string[] = [];
      const realSet = memoryStore.setSecret.bind(memoryStore);
      const realGated = memoryStore.setGatedSecret.bind(memoryStore);
      memoryStore.setSecret = async (account: string, secret: string) => {
        written.push(secret);
        return realSet(account, secret);
      };
      memoryStore.setGatedSecret = async (account: string, secret: string) => {
        written.push(secret);
        return realGated(account, secret);
      };
      return written;
    }

    test('the credential is nowhere on disk once the call returns', async () => {
      const writes = recordStoreWrites();

      await elevation.withElevation(SESSION, async () => {
        // A command doing ordinary work while elevated. Writing config from
        // inside the window is what an elevated command actually does, and it
        // is the one call that could carry the credential to disk behind the
        // caller's back — so the assertions below read a real, written file
        // rather than an empty directory that would pass by default.
        //
        // Spread over the current config, the way every real caller does,
        // rather than passing a bare object. A bare one rewrites config.json
        // wholesale and so erases anything `withElevation` had persisted
        // before the callback ran — which silently disarmed this test until a
        // deliberate persist-the-key experiment failed to turn it red.
        await config.saveConfig({ ...(await config.getConfig()), defaultOrg: ORG });
      });

      expect(configDirBytes()).not.toContain(CANARY);
      expect(writes.join('\n')).not.toContain(CANARY);
    });

    test('the credential is readable inside the callback and not after it', async () => {
      expect(elevation.currentElevatedKey()).toBeUndefined();

      const insideCallback = await elevation.withElevation(SESSION, async (session) => {
        expect(session.apiKey).toBe(CANARY);
        return elevation.currentElevatedKey();
      });

      expect(insideCallback).toBe(CANARY);
      expect(elevation.currentElevatedKey()).toBeUndefined();
    });

    test('a throwing callback still releases the credential', async () => {
      await expect(
        elevation.withElevation(SESSION, async () => {
          throw new Error('the gated call failed');
        }),
      ).rejects.toThrow('the gated call failed');

      // Releasing only on the success path would rebuild the standing window in
      // miniature: one failed admin command and the key stays live for the rest
      // of the process, which is precisely the state this design removes.
      expect(elevation.currentElevatedKey()).toBeUndefined();
    });
  });
});
