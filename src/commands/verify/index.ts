/**
 * `anima verify <code>` — submit the OTP a freshly signed-up agent's owner
 * received by email, completing the self-service claim handshake.
 *
 * Background: `anima init` (new-agent flow) calls POST /v1/agent/sign-up,
 * which creates a FREE org + agent and emails a 6-digit code to the human
 * the agent listed as its owner. Until that code is submitted the agent is
 * `agent_unverified` and capability-restricted (it can only email its own
 * owner). This command POSTs the code to /v1/agent/verify — the step the
 * CLI previously never exposed, leaving the OTP with nowhere to go.
 *
 * The code is a positional arg so agents can run it non-interactively
 * (`anima verify 123456`); interactive humans with no arg get a prompt.
 *
 * Verify semantics (server-side, see agent-self-service handler): wrong,
 * expired, or too-many-attempts all return HTTP 200 with `verified:false`
 * — the server silently re-emails a fresh code on expiry/lockout. The
 * contract can't tell those cases apart, so the failure copy covers both.
 */

import * as clack from "@clack/prompts";
import { Command } from "commander";
import { getResolvedAuthCredential, type GlobalOptions } from "../../lib/auth.js";
import { ORPCError, requireOrpcAuth } from "../../lib/orpc.js";
import { Output } from "../../lib/output.js";

const OTP_PATTERN = /^\d{6}$/;

export function verifyCommand(): Command {
	return new Command("verify")
		.description(
			"Verify your agent with the OTP code emailed to its owner — unlocks full send capability",
		)
		.argument("[code]", "6-digit verification code from the owner's email")
		.action(async function (this: Command, code: string | undefined) {
			const globals = this.optsWithGlobals<GlobalOptions>();
			// Annotated, not inferred, so a later output.fatal()'s `never` narrows control flow.
			const output: Output = Output.fromGlobals(globals);
			const isHuman = output.format === "human";

			// Resolve the code: positional arg wins; an interactive human with
			// no arg gets prompted. Agents must pass it explicitly.
			let otp = code?.trim();
			if (!otp && isHuman) {
				const entered = await clack.text({
					message: "Enter the 6-digit code from the owner's email:",
					placeholder: "123456",
					validate: (value) => {
						if (!value || !OTP_PATTERN.test(value.trim()))
							return "Enter the 6-digit code.";
					},
				});
				if (clack.isCancel(entered)) {
					output.fatal("Cancelled.");
				}
				otp = (entered as string).trim();
			}
			if (!otp) {
				output.fatal("Missing verification code. Usage: anima verify <code> — the 6-digit code emailed to the agent's owner.");
			}
			if (!OTP_PATTERN.test(otp)) {
				output.fatal("Code must be exactly 6 digits.");
			}

			// The agent key from `anima init` (or `auth login`) authenticates
			// the verify call — the server derives which org/agent to claim
			// from the credential, not from the request body.
			const { credential } = await getResolvedAuthCredential(globals);
			if (!credential) {
				output.fatal("Not authenticated. Run `anima init` to create an agent (or `anima auth login`), then verify.");
			}

			let result: { verified: boolean; auth_type: string };
			try {
				const orpc = await requireOrpcAuth(globals);
				result = await orpc.agentSelfService.verify({ otp_code: otp });
			} catch (error) {
				if (error instanceof ORPCError) {
					if (error.status === 401) {
						output.error(
							"Session expired or invalid credential. Run `anima auth login` (or `anima init`) and try again.",
						);
					} else if (error.status === 404) {
						// Route skew — a published CLI calling an endpoint the
						// deployed API doesn't serve. Same guidance as whoami/onboard.
						output.error(
							"Verification endpoint not found — your CLI is out of date.\n" +
								"Fix: `brew upgrade anima` (or `npm install -g @anima-labs/cli@latest`).",
						);
					} else if (error.status >= 500) {
						output.error(
							`Anima API returned ${error.status}. Check status.useanima.sh; if it persists, contact support@useanima.sh.`,
						);
					} else {
						output.error(`Verification failed: ${error.message} (${error.status})`);
					}
				} else if (error instanceof Error) {
					output.error(`Verification failed: ${error.message}`);
				} else {
					output.error("Verification failed.");
				}
				process.exit(1);
			}

			if (result.verified) {
				if (isHuman) {
					output.success(
						"Agent verified — full capabilities unlocked. You can now send to anyone.",
					);
				} else {
					output.payload({
						status: "verified",
						verified: true,
						auth_type: result.auth_type,
					});
				}
				return;
			}

			// verified:false — wrong or expired. The server auto-resends a fresh
			// code on expiry/lockout, so point the user back at their inbox.
			if (isHuman) {
				output.error(
					"That code didn't match or has expired. If it expired (or you retried too many times) we've emailed a fresh code to the owner — check their inbox and run `anima verify <code>` again.",
				);
			} else {
				output.payload({
					status: "unverified",
					verified: false,
					auth_type: result.auth_type,
					hint: "Code wrong or expired. A fresh code may have been emailed to the owner. Re-run: anima verify <code>",
				});
			}
			process.exit(1);
		});
}
