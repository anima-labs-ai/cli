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
 *   - RND check (reassigned-number) — server-side, no CLI flag.
 *   - Time-of-day window — server-side, no CLI flag.
 *   - Per-plan daily call cap — server-side, returns 402 with upgrade.
 *
 * Voice is chosen per agent (Agent.voiceId), set in the console — there is
 * no per-call voice or tier override here.
 *
 * Output: callId + state on success, ApiError-translated message on
 * failure. JSON mode dumps the full CreateCallOutput.
 */

import { Command } from "commander";
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
      "Place an outbound voice call (TCPA + RND + time-of-day gated server-side)",
    )
    .requiredOption(
      "--to <number>",
      "Destination phone number in E.164 format (e.g. +14155550142)",
    )
    .option(
      "--agent <id>",
      "Agent identity ID (defaults to the agent of the API key in use)",
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
            output.info(
              "If this is a fresh deploy, the phone feature may not be enabled yet, or the voice-provider credentials are missing.",
            );
          } else if (error.status === 451) {
            // TCPA consent gate — the org has not attested outbound consent.
            output.error(`Outbound not enabled: ${error.message}`);
            output.info(
              "Complete the one-time consent attestation in the console: Settings → Outbound Calling & SMS (Starter plan and above).",
            );
          } else if (error.status === 402) {
            output.error("Per-plan call cap reached for this billing period.");
            output.info(
              "Upgrade at https://console.useanima.sh/settings or wait for the next cycle.",
            );
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
