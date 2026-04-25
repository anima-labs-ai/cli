/**
 * `am voice place` — place an outbound voice call from the CLI.
 *
 * Wraps POST /voice/calls. The call goes through the same server-side
 * gates the API enforces:
 *   - FEATURE_PHONE_ENABLED must be true (otherwise 503 from server).
 *   - TCPA gate requires a consent_source assertion. In the dashboard
 *     that's a per-agent toggle; from the CLI we collect it via flag or
 *     stdin prompt and the API records it with the call for audit.
 *   - RND check (Twilio Lookup) — server-side, no CLI flag.
 *   - Time-of-day window — server-side, no CLI flag.
 *   - Per-tier daily call cap — server-side, returns 402 with upgrade.
 *
 * Output: callId + state on success, ApiError-translated message on
 * failure. JSON mode dumps the full CreateCallOutput.
 */

import { Command } from 'commander';
import { ApiError } from '../../lib/api-client.js';
import { type GlobalOptions, getApiClient } from '../../lib/auth.js';
import { Output } from '../../lib/output.js';

interface PlaceCallOptions {
  to?: string;
  agent?: string;
  tier?: string;
  voiceId?: string;
  greeting?: string;
  fromNumber?: string;
  consentSource?: string;
}

interface PlaceCallResponse {
  callId: string;
  state: string;
  from: string;
  to: string;
  tier: string;
  direction: 'OUTBOUND';
}

const VALID_TIERS = new Set(['basic', 'premium']);

export function placeCallCommand(): Command {
  return new Command('place')
    .description('Place an outbound voice call (TCPA + RND + time-of-day gated server-side)')
    .requiredOption('--to <number>', 'Destination phone number in E.164 format (e.g. +14155550142)')
    .option('--agent <id>', 'Agent identity ID (defaults to the agent of the API key in use)')
    .option('--tier <tier>', 'Voice tier: basic | premium', 'basic')
    .option('--voice-id <id>', 'Voice ID from the catalog (e.g. telnyx:sarah, elevenlabs:rachel)')
    .option('--greeting <text>', 'Opening line spoken when the call connects')
    .option('--from-number <number>', 'Override the dialing-from number (must belong to your org)')
    .option(
      '--consent-source <source>',
      'TCPA consent assertion (e.g. opt-in:web-form, customer-initiated, business-relationship). Required by the TCPA gate.',
    )
    .action(async function (this: Command) {
      const opts = this.opts<PlaceCallOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      if (!opts.to) {
        output.error('Missing --to. Pass an E.164 phone number like +14155550142.');
        process.exit(2);
      }
      if (!opts.to.startsWith('+')) {
        output.error('--to must be E.164 format starting with "+" (e.g. +14155550142).');
        process.exit(2);
      }
      const tier = (opts.tier ?? 'basic').toLowerCase();
      if (!VALID_TIERS.has(tier)) {
        output.error(`--tier must be one of basic | premium, got "${opts.tier}".`);
        process.exit(2);
      }

      // The TCPA gate at apps/api/src/middleware/tcpa-gate.ts requires a
      // consent_source assertion on every outbound call. Surface a clear
      // error here rather than letting the server return a generic 403.
      if (!opts.consentSource) {
        output.error(
          'Missing --consent-source. The TCPA gate requires you to assert how you obtained consent for this call.',
        );
        output.info(
          'Examples: --consent-source opt-in:web-form / customer-initiated / business-relationship',
        );
        output.info(
          'See https://useanima.sh/trust/tcpa-dnc for the full compliance posture and what each value means.',
        );
        process.exit(2);
      }

      try {
        const client = await getApiClient(globals);
        const body: Record<string, unknown> = {
          to: opts.to,
          tier,
          metadata: { consent_source: opts.consentSource },
        };
        if (opts.agent) body.agentId = opts.agent;
        if (opts.voiceId) body.voiceId = opts.voiceId;
        if (opts.greeting) body.greeting = opts.greeting;
        if (opts.fromNumber) body.fromNumber = opts.fromNumber;

        const result = await client.post<PlaceCallResponse>('/voice/calls', body);

        if (globals.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        output.success(`Call placed: ${result.callId}`);
        output.details([
          ['Call ID', result.callId],
          ['State', result.state],
          ['From', result.from],
          ['To', result.to],
          ['Tier', result.tier],
          ['Direction', result.direction],
        ]);
        output.info(`Tail live updates with: am tail --filter voice --agent ${opts.agent ?? '<id>'}`);
        output.info(`View in dashboard: https://console.useanima.sh/audit (search by callId)`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          // Specialized handling for the gates so the operator sees a
          // useful message rather than a generic stack trace.
          if (error.status === 503) {
            output.error(`Voice unavailable: ${error.message}`);
            output.info(
              'If this is a fresh deploy, the FEATURE_PHONE_ENABLED flag may not be on yet, or TELNYX_API_KEY / TELNYX_CONNECTION_ID is missing.',
            );
          } else if (error.status === 402) {
            output.error('Per-tier call cap reached for this billing period.');
            output.info('Upgrade at https://console.useanima.sh/settings or wait for the next cycle.');
          } else if (error.status === 403) {
            output.error(`Blocked by safety gate: ${error.message}`);
          } else {
            output.error(`HTTP ${error.status} ${error.code}: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
