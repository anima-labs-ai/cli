import * as clack from '@clack/prompts';
import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { type GlobalOptions, resolveApiUrl } from '../../lib/auth.js';
import { getAuthConfig, getConfig } from '../../lib/config.js';
import {
  type ElevateApiResponse,
  NotEnrolledError,
  activateSession,
  canHoldGrant,
  elevateWithGrant,
  enrollmentFor,
  post,
  recordEnrollment,
} from '../../lib/elevation.js';
import { Output } from '../../lib/output.js';

/**
 * `am auth elevate` — get admin access for a while.
 *
 * Two paths, and which one runs is not a flag the user has to think about:
 *
 *   not enrolled → an emailed code, spent once, which also enrols this machine
 *   enrolled     → the OS asks for the login password, no email at all
 *
 * The emailed code is deliberately demoted to an enrolment step. As a recurring
 * factor it is weak here — Anima sells agents with mailbox access, so the thing
 * being gated may be able to read the gate — and it takes the human out of the
 * terminal every time. Enrolment converts it into something an agent cannot
 * satisfy at all: a system password dialog it has no way to answer.
 *
 * See lib/elevation.ts for what that gate is and is not worth.
 *
 * Called over raw fetch, like `init`'s sign-up call, because these endpoints
 * are agent-self-service and the CLI's contract pin (.anima-ref) does not carry
 * them yet.
 */

interface ElevateRequestResponse {
  sent_to: string;
  expires_at: string;
}

interface ElevateWireResponse {
  api_key: string;
  api_key_id: string;
  expires_at: string;
  grant?: string;
  grant_expires_at?: string;
}

export function elevateCommand(): Command {
  return new Command('elevate')
    .description('Get temporary admin access, using this machine or a code emailed to the owner')
    .option(
      '--code <otp>',
      'The 6-digit code, to skip the prompt (for scripts)',
      requireNonEmptyArg('Code'),
    )
    .option(
      '--email',
      'Force the emailed-code path, re-enrolling this machine (use after revoking a grant)',
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ code?: string; email?: boolean }>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output: Output = Output.fromGlobals(globals);

      const auth = await getAuthConfig();
      const credential = auth.apiKey ?? auth.token;
      if (!credential) {
        output.fatal('Not authenticated. Run `am init` or `am auth login` first.');
      }
      const apiUrl = resolveApiUrl(globals);
      const orgId = (await getConfig()).defaultOrg;

      // ── Enrolled already? Then no email, just the machine. ──
      const enrolled = orgId !== undefined && (await enrollmentFor(orgId)) !== undefined;
      if (enrolled && opts.email !== true && opts.code === undefined) {
        try {
          const session = await elevateWithGrant(globals);
          const { profile, previous } = await activateSession(session, apiUrl);
          if (globals.json) {
            output.json({
              status: 'elevated',
              via: 'machine',
              profile,
              expires_at: session.expiresAt,
              api_key_id: session.apiKeyId,
              previous_profile: previous ?? null,
            });
            return;
          }
          output.success(`Admin access active until ${session.expiresAt}.`);
          output.info(backToNormal(profile, previous));
          return;
        } catch (err: unknown) {
          if (err instanceof NotEnrolledError) {
            // The grant went stale (revoked, expired, or removed). Say so, then
            // fall through to the emailed code rather than dead-ending on a
            // command the user has to re-run by hand.
            output.warn(err.message);
          } else {
            output.fatal(err instanceof Error ? err.message : String(err));
          }
        }
      }

      // ── Emailed code. Also enrols this machine when it can hold a grant. ──
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

      output.info(
        `Code sent to ${requested.data.sent_to}. It expires at ${requested.data.expires_at}.`,
      );

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

      // Only ask for a grant when this machine can actually gate one. On a
      // backend without a human-presence gate the grant would be a 90-day
      // credential sitting in storage that anything running as the user can
      // read — strictly worse than the emailed code it would replace.
      const wantGrant = canHoldGrant() && orgId !== undefined;

      const elevated = await post<ElevateWireResponse>(apiUrl, '/v1/agent/elevate', credential, {
        otp_code: code,
        ...(wantGrant ? { enroll: true } : {}),
      });
      if (!elevated.ok) {
        output.error(`Step-up failed: ${elevated.message}`);
        process.exit(1);
      }

      const session: ElevateApiResponse = {
        apiKey: elevated.data.api_key,
        apiKeyId: elevated.data.api_key_id,
        expiresAt: elevated.data.expires_at,
      };

      let enrolledNow = false;
      if (wantGrant && elevated.data.grant && elevated.data.grant_expires_at) {
        try {
          await recordEnrollment(
            orgId as string,
            elevated.data.grant,
            elevated.data.grant_expires_at,
          );
          enrolledNow = true;
        } catch (err: unknown) {
          // Enrolment is an optimisation on top of a step-up that already
          // worked. Losing it costs another email next time, which is worth
          // far less than throwing away the session the user just earned.
          output.warn(
            `Admin access is active, but this machine could not be enrolled: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      const { profile, previous } = await activateSession(session, apiUrl);

      if (globals.json) {
        output.json({
          status: 'elevated',
          via: 'email',
          enrolled: enrolledNow,
          profile,
          expires_at: session.expiresAt,
          api_key_id: session.apiKeyId,
          previous_profile: previous ?? null,
        });
        return;
      }

      output.success(`Admin access active until ${session.expiresAt}.`);
      if (enrolledNow) {
        output.info(
          'This machine is now enrolled. Next time `am auth elevate` asks for your login password instead of emailing a code.',
        );
      }
      output.info(backToNormal(profile, previous));
    });
}

function backToNormal(profile: string, previous: string | undefined): string {
  return `Switched to profile "${profile}". Back to normal:  am config profile use ${previous ?? 'default'}`;
}
