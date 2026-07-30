/**
 * Owner grants — reaching master capability without leaving the terminal.
 *
 * The problem this solves: the key `am init` stores is agent-scoped, and an org
 * created that way has no other route to master. `clerkOrgId` is null, so both
 * Clerk paths are shut, and the org's durable master key is returned by no
 * endpoint. Roughly a hundred operations — creating an agent, the event stream,
 * key management — sat behind that wall.
 *
 * The first answer was an emailed code. It is a poor *recurring* factor here
 * for two reasons the product itself creates: Anima sells agents with mailbox
 * access, so the thing being gated may be able to read the gate; and it takes
 * the human out of the CLI on every privileged command.
 *
 * So the code became an enrolment step. Spend it once, receive a durable grant,
 * and keep the grant where the OS will not release it without a human: a
 * keychain item with an empty trusted-application list, which makes macOS
 * demand the login password before any process — this CLI included — can read
 * it back. An agent driving the terminal holds the API key and can run every
 * command, but it cannot answer that dialog.
 *
 * What this is honestly worth:
 *   • It gates the grant *at rest on this machine*. The server cannot verify
 *     that a human was present, so a grant already extracted still works from
 *     anywhere. The gate narrows who can extract it, not what it does after.
 *   • The dialog offers "Always Allow", which would permanently admit
 *     `security` to the item's ACL. {@link readGrant} re-arms the gate straight
 *     after every read, so a mis-click costs one command rather than forever.
 *   • macOS only. Elsewhere `humanPresenceGate` is false and the CLI refuses to
 *     store a grant rather than pretend one is protected — those platforms keep
 *     using the emailed code.
 */

import { type GlobalOptions, resolveApiUrl } from './auth.js';
import {
  ELEVATED_PROFILE_SUFFIX,
  getAuthConfig,
  getConfig,
  saveConfig,
  secureStore as store,
} from './config.js';

/** Keychain account holding an org's grant. Namespaced so it cannot collide
 *  with auth.json's host-keyed accounts or `profile:<name>` entries. */
function grantAccount(orgId: string): string {
  return `grant:${orgId}`;
}

export interface ElevatedSession {
  apiKey: string;
  apiKeyId: string;
  expiresAt: string;
}

/** Raised when elevation cannot even be attempted, with the way forward. */
export class NotEnrolledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotEnrolledError';
  }
}

export async function post<T>(
  apiUrl: string,
  path: string,
  credential: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    // The API answers with either the oRPC envelope or `{ error: {...} }`; both
    // carry a message worth showing verbatim, since these are the rate-limit
    // and wrong-code cases the user has to act on.
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: { message?: string } };
      message = parsed.error?.message ?? parsed.message ?? message;
    } catch {
      // Non-JSON body — the truncated text is the best available.
    }
    return { ok: false, status: response.status, message };
  }
  return { ok: true, data: JSON.parse(text) as T };
}

/** Can this machine hold a grant at all? False → the emailed code is the path. */
export function canHoldGrant(): boolean {
  return store().humanPresenceGate;
}

/**
 * Is this org enrolled here? Reads the config marker, never the keychain, so
 * asking the question cannot itself raise a password dialog.
 */
export async function enrollmentFor(orgId: string) {
  return (await getConfig()).enrollments?.[orgId];
}

export async function recordEnrollment(
  orgId: string,
  grant: string,
  grantExpiresAt: string,
): Promise<void> {
  // Keychain first. If the gated write fails there must be no marker claiming
  // otherwise, or every later step-up would prompt for a secret that is not
  // there and report the wrong reason for failing.
  await store().setGatedSecret(grantAccount(orgId), grant);

  const config = await getConfig();
  await saveConfig({
    ...config,
    enrollments: {
      ...config.enrollments,
      [orgId]: { enrolledAt: new Date().toISOString(), grantExpiresAt },
    },
  });
}

export async function forgetEnrollment(orgId: string): Promise<void> {
  try {
    await store().deleteSecret(grantAccount(orgId));
  } catch {
    // Backend unavailable — drop the marker anyway. A marker with no secret
    // behind it is the more confusing of the two states to leave lying around.
  }
  const config = await getConfig();
  if (!config.enrollments?.[orgId]) return;
  const { [orgId]: _removed, ...rest } = config.enrollments;
  await saveConfig({ ...config, enrollments: rest });
}

/**
 * Read the grant, raising the OS password dialog, then immediately re-arm the
 * gate.
 *
 * The re-arm is the point. macOS offers "Always Allow" on that dialog, and
 * taking it adds `security` to the item's ACL permanently — every later read,
 * by anything, would then succeed silently. Rewriting the item with an empty
 * trusted-application list puts the gate back, so the worst a mis-click can do
 * is leave this one command unprotected.
 */
export async function readGrant(orgId: string): Promise<string | null> {
  const account = grantAccount(orgId);
  const grant = await store().getSecret(account);
  if (grant === null) return null;

  try {
    await store().setGatedSecret(account, grant);
  } catch {
    // Re-arming failed. The caller still has a usable grant, so let the command
    // proceed; the gate is no weaker than it was a moment ago, and failing here
    // would turn a hardening step into an outage.
  }
  return grant;
}

/**
 * Trade this machine's grant for a short-lived master credential.
 *
 * Throws {@link NotEnrolledError} when there is nothing to trade, so callers
 * can tell "you need to enrol" apart from "the exchange was refused" — the
 * first is a one-command fix, the second may mean a revoked grant.
 */
export async function elevateWithGrant(opts: GlobalOptions): Promise<ElevatedSession> {
  const auth = await getAuthConfig();
  const credential = auth.apiKey ?? auth.token;
  if (!credential) {
    throw new NotEnrolledError('Not authenticated. Run `am init` or `am auth login` first.');
  }

  const config = await getConfig();
  const orgId = config.defaultOrg;
  if (!orgId) {
    throw new NotEnrolledError('No organization is configured. Run `am init` first.');
  }
  if (!(await enrollmentFor(orgId))) {
    throw new NotEnrolledError(
      canHoldGrant()
        ? 'This machine is not enrolled for admin access yet. Run `am auth elevate` once to enrol.'
        : `${store().name} cannot gate a secret on human presence, so no grant is kept here. ` +
          'Run `am auth elevate` and use the emailed code.',
    );
  }

  const grant = await readGrant(orgId);
  if (grant === null) {
    // Marker present, secret gone — the keychain entry was removed out from
    // under us. Clear the marker so the next run asks for enrolment instead of
    // repeating this.
    await forgetEnrollment(orgId);
    throw new NotEnrolledError(
      'The stored admin grant is gone from your keychain. Run `am auth elevate` to enrol again.',
    );
  }

  const apiUrl = resolveApiUrl(opts, auth.apiUrl);
  const result = await post<{ api_key: string; api_key_id: string; expires_at: string }>(
    apiUrl,
    '/v1/agent/elevate',
    credential,
    { grant },
  );
  if (!result.ok) {
    // A refused grant is spent: revoked, expired, or issued for another org.
    // Dropping it locally keeps the next command from prompting for a secret
    // the server has already said it will not accept.
    if (result.status === 403) {
      await forgetEnrollment(orgId);
      throw new NotEnrolledError(
        `${result.message} Run \`am auth elevate\` to enrol this machine again.`,
      );
    }
    throw new Error(`Step-up failed: ${result.message}`);
  }

  return {
    apiKey: result.data.api_key,
    apiKeyId: result.data.api_key_id,
    expiresAt: result.data.expires_at,
  };
}

/** The profile a privileged session lands in. */
export function elevatedProfileName(orgId: string | undefined): string {
  return orgId ? `${orgId}-${ELEVATED_PROFILE_SUFFIX}` : ELEVATED_PROFILE_SUFFIX;
}

/**
 * Park a privileged session in its own profile and switch to it.
 *
 * Not written over the active credential: this key expires in minutes, and
 * overwriting the agent key with it would leave the machine holding a dead
 * credential and no obvious way back.
 */
export async function activateSession(
  session: ElevatedSession,
  apiUrl: string,
): Promise<{ profile: string; previous: string | undefined }> {
  const config = await getConfig();
  const previous = config.activeProfile;
  const name = elevatedProfileName(config.defaultOrg);

  await saveConfig({
    ...config,
    activeProfile: name,
    profiles: {
      ...config.profiles,
      [name]: {
        apiUrl,
        apiKey: session.apiKey,
        defaultOrg: config.defaultOrg,
        defaultIdentity: config.defaultIdentity,
        outputFormat: config.outputFormat,
        expiresAt: session.expiresAt,
      },
    },
  });

  return { profile: name, previous: previous === name ? undefined : previous };
}

/**
 * True when a privileged session is already active and still valid, so a
 * caller can skip the dialog entirely.
 *
 * This is what makes the flow behave like `sudo` rather than prompting on every
 * command in a sequence: the first admin command in a burst asks for the
 * password, the rest ride the session until it lapses.
 */
export async function hasLiveSession(): Promise<boolean> {
  const config = await getConfig();
  const active = config.activeProfile;
  if (!active) return false;
  const profile = config.profiles?.[active];
  if (!profile?.apiKey || active !== elevatedProfileName(config.defaultOrg)) return false;
  if (!profile.expiresAt) return true;
  return Date.parse(profile.expiresAt) > Date.now();
}
