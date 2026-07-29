import * as clack from '@clack/prompts';
import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { type GlobalOptions, resolveApiUrl } from '../../lib/auth.js';
import {
  getActiveProfile,
  getAuthConfig,
  getConfig,
  saveConfig,
  setActiveProfile,
} from '../../lib/config.js';
import { Output } from '../../lib/output.js';

/**
 * `am auth elevate` — trade a code from the owner's inbox for a short-lived
 * key that can do master work.
 *
 * The key `am init` stores is agent-scoped, and an org created that way has no
 * other route to master capability: `clerkOrgId` is null, so the Clerk and
 * OAuth paths are closed, and the org's master key is returned by no endpoint.
 * That left creating an agent, reading the event stream and managing keys
 * permanently out of reach — the wall this session kept hitting.
 *
 * The factor is the inbox, which is what makes this a boundary rather than a
 * prompt: whatever is driving the CLI already holds the API key, so asking it
 * for a local password would prove nothing. Only the human reads the owner's
 * mail.
 *
 * Called over raw fetch, like `init`'s sign-up call, because these endpoints
 * are agent-self-service and the CLI's contract pin (.anima-ref) does not
 * carry them yet.
 */

interface ElevateRequestResponse {
  sent_to: string;
  expires_at: string;
}

interface ElevateResponse {
  api_key: string;
  api_key_id: string;
  expires_at: string;
}

/** The profile a privileged session lands in. */
function elevatedProfileName(orgId: string | undefined): string {
  return orgId ? `${orgId}-elevated` : 'elevated';
}

async function post<T>(
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
    // The API answers with either the oRPC envelope or `{ error: {...} }`;
    // both carry a message worth showing verbatim, since these are the
    // rate-limit and wrong-code cases the user needs to act on.
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

export function elevateCommand(): Command {
  return new Command('elevate')
    .description('Get temporary admin access using a code emailed to the org owner')
    .option(
      '--code <otp>',
      'The 6-digit code, to skip the prompt (for scripts)',
      requireNonEmptyArg('Code'),
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ code?: string }>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output: Output = Output.fromGlobals(globals);

      const auth = await getAuthConfig();
      const credential = auth.apiKey ?? auth.token;
      if (!credential) {
        output.fatal('Not authenticated. Run `am init` or `am auth login` first.');
      }
      const apiUrl = resolveApiUrl(globals);

      // ── Ask for a code ──
      const requested = await post<ElevateRequestResponse>(
        apiUrl,
        '/v1/agent/elevate/request',
        credential,
        {},
      );
      if (!requested.ok) {
        output.error(`Could not request a step-up code: ${requested.message}`);
        if (requested.status === 404) {
          output.info(
            'This API does not offer step-up yet. Use a master key (mk_…) via `am init` → "existing API key".',
          );
        }
        process.exit(1);
      }

      output.info(`Code sent to ${requested.data.sent_to}. It expires at ${requested.data.expires_at}.`);

      // ── Exchange it ──
      let code = opts.code;
      if (code === undefined) {
        const answer = await clack.text({
          message: 'Enter the code from the owner’s email:',
          placeholder: '123456',
          validate: (value) => {
            if (!/^\d{6}$/.test((value ?? '').trim())) return 'Six digits.';
          },
        });
        if (clack.isCancel(answer)) {
          output.error('Cancelled. No code was used; request a new one when ready.');
          process.exit(1);
        }
        code = (answer as string).trim();
      }

      const elevated = await post<ElevateResponse>(apiUrl, '/v1/agent/elevate', credential, {
        otp_code: code,
      });
      if (!elevated.ok) {
        output.error(`Step-up failed: ${elevated.message}`);
        process.exit(1);
      }

      // ── Park it in its own profile ──
      //
      // Not written over the active credential: this key expires in minutes,
      // and overwriting the agent key with it would leave the machine with a
      // dead credential and no obvious way back. A profile keeps both, and
      // `saveConfig` puts the secret in the OS keychain rather than
      // config.json.
      const config = await getConfig();
      const previous = (await getActiveProfile())?.name;
      const name = elevatedProfileName(config.defaultOrg);

      await saveConfig({
        ...config,
        profiles: {
          ...config.profiles,
          [name]: {
            apiUrl,
            apiKey: elevated.data.api_key,
            defaultOrg: config.defaultOrg,
            defaultIdentity: config.defaultIdentity,
            outputFormat: config.outputFormat,
          },
        },
      });
      await setActiveProfile(name);

      if (globals.json) {
        output.json({
          status: 'elevated',
          profile: name,
          expires_at: elevated.data.expires_at,
          api_key_id: elevated.data.api_key_id,
          previous_profile: previous ?? null,
        });
        return;
      }

      output.success(`Admin access active until ${elevated.data.expires_at}.`);
      output.info(
        previous
          ? `Switched to profile "${name}". Back to normal:  am config profile use ${previous}`
          : `Switched to profile "${name}". Back to normal:  am config profile use default`,
      );
    });
}
