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

import * as clack from '@clack/prompts';
import { type GlobalOptions, resolveApiUrl } from './auth.js';
import { getAuthConfig, getConfig, saveConfig, secureStore as store } from './config.js';

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

/** `/v1/agent/elevate/request` — where the enrolment code was emailed. */
interface ElevateRequestResponse {
  sent_to: string;
  expires_at: string;
}

/** `/v1/agent/elevate` — the grant fields appear only when `enroll` was asked for. */
interface ElevateWireResponse {
  api_key: string;
  api_key_id: string;
  expires_at: string;
  grant?: string;
  grant_expires_at?: string;
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
 * Spend an emailed code to enrol this machine, and return the credential that
 * exchange already yields.
 *
 * This used to be `am auth elevate`. It stopped deserving a command of its own
 * once the credential lived for a single call: "elevate" is no longer a state
 * you enter and then work inside, so there is nothing for a standalone command
 * to hand back. What remains is a once-per-machine setup step, and the moment
 * to run it is the moment the user turns out to need it.
 *
 * The emailed code is deliberately only this. As a *recurring* factor it is
 * weak here — Anima sells agents with mailbox access, so the thing being gated
 * may be able to read the gate — and it takes the human out of the terminal
 * every time. Spent once for a grant, it becomes something an agent cannot
 * satisfy at all: a system password dialog it has no way to answer.
 *
 * Called over raw fetch, like `init`'s sign-up call, because these endpoints
 * are agent-self-service and the CLI's contract pin (.anima-ref) does not carry
 * them yet.
 */
async function enrollThisMachine(
  apiUrl: string,
  credential: string,
  orgId: string,
): Promise<ElevatedSession> {
  // No terminal, no enrolment — and saying so is the whole point. The code has
  // to be read out of an inbox and typed back in, so a CI job or an agent
  // driving `am` would otherwise sit on a prompt that nothing is ever going to
  // answer. Failing here costs a command; hanging costs the job's timeout and
  // tells the operator nothing about why.
  if (!process.stdin.isTTY) {
    throw new NotEnrolledError(
      canHoldGrant()
        ? 'This machine is not enrolled for admin access. Enrolling emails a code to the ' +
          'organization owner that has to be typed back in, so it needs an interactive ' +
          'terminal — once. Run an admin command from a terminal first.'
        : `${store().name} cannot gate a secret on human presence, so no grant is kept here ` +
          'and every step-up needs the code emailed to the organization owner. Run this from ' +
          'an interactive terminal.',
    );
  }

  const requested = await post<ElevateRequestResponse>(
    apiUrl,
    '/v1/agent/elevate/request',
    credential,
    {},
  );
  if (!requested.ok) {
    throw new NotEnrolledError(
      requested.status === 404
        ? `Could not request a step-up code: ${requested.message} This API does not offer ` +
          'step-up yet. Use a master key (mk_…) via `am init` → "existing API key".'
        : `Could not request a step-up code: ${requested.message}`,
    );
  }

  process.stderr.write(
    `Code sent to ${requested.data.sent_to}. It expires at ${requested.data.expires_at}.\n`,
  );

  const answer = await clack.text({
    message: 'Enter the code from the owner’s email:',
    placeholder: '123456',
    validate: (value) => {
      if (!/^\d{6}$/.test((value ?? '').trim())) return 'Six digits.';
    },
  });
  if (clack.isCancel(answer)) {
    throw new NotEnrolledError('Cancelled. No code was used; request a new one when ready.');
  }
  const code = (answer as string).trim();

  // Only ask for a grant when this machine can actually gate one. On a backend
  // without a human-presence gate the grant would be a 90-day credential
  // sitting in storage that anything running as the user can read — strictly
  // worse than the emailed code it would replace.
  const wantGrant = canHoldGrant();

  const elevated = await post<ElevateWireResponse>(apiUrl, '/v1/agent/elevate', credential, {
    otp_code: code,
    ...(wantGrant ? { enroll: true } : {}),
  });
  if (!elevated.ok) {
    throw new Error(`Step-up failed: ${elevated.message}`);
  }

  if (wantGrant && elevated.data.grant && elevated.data.grant_expires_at) {
    try {
      await recordEnrollment(orgId, elevated.data.grant, elevated.data.grant_expires_at);
      process.stderr.write(
        'This machine is now enrolled. Later admin commands ask for your login password ' +
          'instead of emailing a code.\n',
      );
    } catch (err: unknown) {
      // Enrolment is an optimisation on top of a step-up that already worked.
      // Losing it costs another email next time, which is worth far less than
      // throwing away the credential the user has just earned.
      process.stderr.write(
        `This machine could not be enrolled: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  return {
    apiKey: elevated.data.api_key,
    apiKeyId: elevated.data.api_key_id,
    expiresAt: elevated.data.expires_at,
  };
}

/**
 * Trade this machine's grant for a short-lived master credential, enrolling
 * first when there is no usable grant to trade.
 *
 * Every route to "no grant" ends in the same place — enrol and continue —
 * rather than in an error naming a command to run next. There is no such
 * command any more, and there is nothing a second invocation would know that
 * this one does not.
 *
 * Throws {@link NotEnrolledError} when enrolment cannot even be attempted: no
 * credential, no org, or no terminal to type the code into.
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

  const apiUrl = resolveApiUrl(opts, auth.apiUrl);

  if (!(await enrollmentFor(orgId))) {
    return enrollThisMachine(apiUrl, credential, orgId);
  }

  const grant = await readGrant(orgId);
  if (grant === null) {
    // Marker present, secret gone — the keychain entry was removed out from
    // under us. Clear the marker, then enrol: the user did not choose this
    // state and cannot see it, so reporting it and stopping would only make
    // them re-run the command that is already running.
    await forgetEnrollment(orgId);
    return enrollThisMachine(apiUrl, credential, orgId);
  }

  const result = await post<{ api_key: string; api_key_id: string; expires_at: string }>(
    apiUrl,
    '/v1/agent/elevate',
    credential,
    { grant },
  );
  if (!result.ok) {
    // A refused grant is spent: revoked, expired, or issued for another org.
    // Dropping it locally keeps the next command from prompting for a secret
    // the server has already said it will not accept. Say why before falling
    // back to the code, or the email arrives with no explanation.
    if (result.status === 403) {
      await forgetEnrollment(orgId);
      process.stderr.write(`${result.message} Enrolling this machine again.\n`);
      return enrollThisMachine(apiUrl, credential, orgId);
    }
    throw new Error(`Step-up failed: ${result.message}`);
  }

  return {
    apiKey: result.data.api_key,
    apiKeyId: result.data.api_key_id,
    expiresAt: result.data.expires_at,
  };
}

/**
 * The privileged credential currently in force, if any.
 *
 * Held in memory, for the span of one call, and nowhere else.
 *
 * What this replaced parked the credential in a profile and marked that profile
 * active, which granted master authority to *everything* running `am` on this
 * machine until it lapsed. The keychain gate does not narrow that: it is paid
 * once, by the human who elevated, and the window it opens is inherited by
 * every later process, an agent shelling out included. Inside that window the
 * agent reads every vault secret, and `apiKeys.create` lets it mint itself a
 * permanent master key that outlives the session entirely. So the window, not
 * the exchange, is what had to go.
 *
 * Process memory is the right place because it is exactly as wide as the
 * authority should be: one command, one dialog, one use. Nothing survives the
 * process, so nothing is left for the next one to inherit.
 */
let elevatedKey: string | undefined;

export function currentElevatedKey(): string | undefined {
  return elevatedKey;
}

/**
 * Run `fn` with the elevated credential in force, then drop it.
 *
 * The release is in a `finally` rather than after the call because a failed
 * privileged command is the likeliest way in. A trailing assignment would leave
 * the credential live for the rest of the process on every throw — the standing
 * window again, rebuilt in miniature and reachable by making one admin command
 * fail.
 */
export async function withElevation<T>(
  session: ElevatedSession,
  fn: (session: ElevatedSession) => Promise<T>,
): Promise<T> {
  elevatedKey = session.apiKey;
  try {
    return await fn(session);
  } finally {
    elevatedKey = undefined;
  }
}
