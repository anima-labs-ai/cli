/**
 * `am voice place` — place an outbound voice call from the CLI.
 *
 * Wraps POST /voice/calls with { to, agentId?, greeting?, fromNumber? }.
 * The call goes through the same server-side gates the API enforces:
 *   - FEATURE_PHONE_ENABLED must be true (otherwise 503 from server).
 *   - TCPA consent gate: the ORG must have completed outbound consent
 *     attestation (console → Settings → Outbound Calling & SMS). Once
 *     attested, dialing is self-serve — there is NO per-call consent flag;
 *     an un-attested org gets a 451 with the same guidance.
 *   - Per-plan MONTHLY call cap (Starter 250, Growth 1000, Enterprise
 *     20000) plus a 5-calls-per-second ceiling — 402 and 429 respectively.
 *   - Voice spend ceiling: calls stop at the plan's included minutes
 *     unless the org opted in to metered overage and named a dollar
 *     limit. Past both, 402 with `resource: "voice"` in details.
 *
 * NOT gates, despite the common assumption: there is no reassigned-number
 * (RND) scrub and no calling-hour window. The RND lookup exists in the API
 * repo but is disabled in production and has never run on a real call, and
 * local time is never computed. Both obligations stay with the caller — do
 * not let this command's output imply otherwise.
 *
 * Voice is chosen per agent (Agent.voiceId), set in the console — there is
 * no per-call voice or tier override here.
 *
 * Output: callId + state on success, ApiError-translated message on
 * failure. JSON mode dumps the full CreateCallOutput.
 */

import { Command } from "commander";
import { requireNonEmptyArg } from "../../lib/args.js";
import { type GlobalOptions } from "../../lib/auth.js";
import { ORPCError, requireOrpcAuth } from "../../lib/orpc.js";
import { Output } from "../../lib/output.js";

interface PlaceCallOptions {
  to?: string;
  agent?: string;
  greeting?: string;
  fromNumber?: string;
}

export function placeCallCommand(): Command {
  return new Command("place")
    .description(
      "Place an outbound voice call (TCPA consent, plan caps and voice spend gated server-side)",
    )
    .requiredOption(
      "--to <number>",
      "Destination phone number in E.164 format (e.g. +14155550142)",
    )
    .option(
      "--agent <id>",
      "Agent identity ID (defaults to the agent of the API key in use)",
      requireNonEmptyArg("Agent ID"),
    )
    .option("--greeting <text>", "Opening line spoken when the call connects")
    .option(
      "--from-number <number>",
      "Override the dialing-from number (must belong to your org)",
    )
    .action(async function (this: Command) {
      const opts = this.opts<PlaceCallOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      // Annotated, not inferred, so a later output.fatal()'s `never` narrows control flow.
      const output: Output = Output.fromGlobals(globals);

      if (!opts.to) {
        output.fatal(
          "Missing --to. Pass an E.164 phone number like +14155550142.",
          2,
        );
      }
      if (!opts.to.startsWith("+")) {
        output.fatal(
          '--to must be E.164 format starting with "+" (e.g. +14155550142).',
          2,
        );
      }

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.voice.createCall({
          to: opts.to,
          agentId: opts.agent,
          greeting: opts.greeting,
          fromNumber: opts.fromNumber,
        });

        if (globals.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        output.success(`Call placed: ${result.callId}`);
        output.details([
          ["Call ID", result.callId],
          ["State", result.state],
          ["From", result.from],
          ["To", result.to],
          ["Direction", result.direction],
        ]);
        output.info(
          `Tail live updates with: am tail --filter voice --agent ${opts.agent ?? "<id>"}`,
        );
        output.info(
          `View in dashboard: https://console.useanima.sh/audit (search by callId)`,
        );
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          // Specialized handling for the gates so the operator sees a
          // useful message rather than a generic stack trace.
          if (error.status === 503) {
            output.error(`Voice unavailable: ${error.message}`);
            output.notice(
              "If this is a fresh deploy, the phone feature may not be enabled yet, or the voice-provider credentials are missing.",
            );
          } else if (error.status === 451) {
            // TCPA consent gate — the org has not attested outbound consent.
            output.error(`Outbound not enabled: ${error.message}`);
            output.notice(
              "Complete the one-time consent attestation in the console: Settings → Outbound Calling & SMS (Starter plan and above).",
            );
          } else if (error.status === 402) {
            // Two different walls return 402 and the remedies are opposite:
            // a call-count cap clears next cycle, a spend ceiling does not —
            // telling someone to "wait for the next cycle" when they need to
            // raise a dollar limit sends them away for a month. The server
            // says which in details.resource.
            const details = error.data as Record<string, unknown> | undefined;
            if (details?.resource === 'voice') {
              output.error(error.message);
              output.notice(
                'Enable metered overage or raise your spend limit in the console: Billing → Metered overage.',
              );
            } else {
              output.error(
                error.message || 'Per-plan call cap reached for this billing period.',
              );
              output.notice(
                'Upgrade at https://console.useanima.sh/billing or wait for the next cycle.',
              );
            }
          } else if (error.status === 403) {
            output.error(`Blocked by safety gate: ${error.message}`);
          } else {
            output.error(
              `HTTP ${error.status} ${error.code}: ${error.message}`,
            );
          }
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
