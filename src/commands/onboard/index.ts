/**
 * `anima onboard` — guided post-signup tour of agentic-commerce capabilities.
 *
 * Designed to mirror `link-cli onboard` from Stripe, but for Anima's multi-
 * channel surface (email + phone + voice + vault). Targets the
 * developer who has just installed the CLI and wants to understand what
 * Anima can do.
 *
 * Flow:
 *   1. Verify authentication (offer `anima auth login` or `anima init` if not)
 *   2. Greet + show identity (whoami)
 *   3. Show capability matrix at the user's plan tier
 *   4. Offer to run quick demos in test mode (test email send, x402 sandbox
 *      fetch). User opts in/out per demo.
 *   5. MCP install status — offer to wire Claude Code / Cursor / etc.
 *   6. Print summary with next-step commands.
 *
 * Test mode: every demo uses `--test` flag (Wave 2C) so no real emails sent,
 * no real numbers provisioned.
 */

import * as clack from "@clack/prompts";
import { Command } from "commander";
import { getResolvedAuthCredential, type GlobalOptions } from "../../lib/auth.js";
import { runInteractiveInit } from "../init/index.js";
import { ORPCError, requireOrpcAuth } from "../../lib/orpc.js";
import { Output } from "../../lib/output.js";

interface OnboardOptions {
	skipDemo?: boolean;
	skipMcp?: boolean;
}

export function onboardCommand(): Command {
	return new Command("onboard")
		.description(
			"Guided tour of Anima — auth check, capability overview, test-mode demos, MCP install",
		)
		.option("--skip-demo", "Skip the test-mode demos", false)
		.option("--skip-mcp", "Skip the MCP install prompt", false)
		.action(async function (this: Command) {
			const opts = this.opts<OnboardOptions>();
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);

			// Agent format: pure JSON status. No interactive prompts — agents
			// running this in a pipe get a structured plan instead of a UI.
			const isAgent = output.format !== "human";

			// ── Step 1: Auth check ──
			const { credential } = await getResolvedAuthCredential(globals);
			if (!credential) {
				// Non-interactive callers (agents, pipes, explicit machine
				// formats) can't be dropped into the interactive sign-up wizard
				// — hand back a structured next-step instead. `output.format` is
				// TTY-aware, so a human running `anima onboard` in a terminal
				// (even without --human) takes the interactive branch below and
				// goes straight into setup.
				if (output.format !== "human") {
					output.payload({
						status: "needs_auth",
						next_command: "anima init",
						hint: "No credential found. Run `anima init` to create an agent (or `anima auth login` if you already have an account).",
					});
					process.exit(1);
				}
				// Interactive human: start `anima init` right here instead of
				// telling them to run another command. init's own mode-select
				// covers both new sign-up and existing-key configuration.
				clack.log.warn(
					"You're not signed in yet — starting setup with `anima init`.",
				);
				await runInteractiveInit(globals, output);
				return;
			}

			// ── Step 2: Identity ──
			// Was `/auth/me` — never existed in prod. `/orgs/me` is the working
			// equivalent. We only consume non-secret fields.
			let me: Awaited<ReturnType<Awaited<ReturnType<typeof requireOrpcAuth>>["org"]["me"]>> | null = null;
			let orpc: Awaited<ReturnType<typeof requireOrpcAuth>> | null = null;
			try {
				orpc = await requireOrpcAuth(globals);
				me = await orpc.org.me({});
			} catch (error) {
				if (error instanceof ORPCError && error.status === 401) {
					if (isAgent) {
						output.payload({
							status: "session_expired",
							next_command: "anima auth login",
						});
						process.exit(1);
					}
					clack.log.error(
						"Your session expired. Run `anima auth login` and try again.",
					);
					return;
				}
				if (error instanceof ORPCError && error.status === 404) {
					// Route skew: the CLI is calling an endpoint this API doesn't
					// serve — almost always a published CLI running ahead of (or
					// behind) the deployed server. The bare oRPC message here is
					// "Route not found", which is opaque; translate it into the
					// actual fix. (This is exactly the 0.6.x `/auth/me` → `/orgs/me`
					// migration footgun.)
					if (isAgent) {
						output.payload({
							status: "cli_outdated",
							message: "Anima API endpoint not found — your CLI is out of date.",
							next_command: "brew upgrade anima",
							hint: "Or: npm install -g @anima-labs/cli@latest",
						});
						process.exit(1);
					}
					clack.log.error(
						"Anima API endpoint not found — your CLI is out of date.\n" +
							"Fix: brew upgrade anima  (or: npm install -g @anima-labs/cli@latest)",
					);
					return;
				}
				if (isAgent) {
					output.payload({
						status: "error",
						message:
							error instanceof Error ? error.message : "Failed to fetch identity",
					});
					process.exit(1);
				}
				clack.log.error(
					`Couldn't fetch your identity: ${error instanceof Error ? error.message : "unknown error"}`,
				);
				return;
			}

			// ── Verification status (non-fatal, agent keys only) ──
			// `auth_type` is the typed source of truth from /v1/agent/status,
			// not org.me's settings blob. We surface it only for agent keys
			// (`ak_`), where the human-claim OTP flow applies — a master /
			// OAuth / session credential isn't an "unverified agent", so the
			// nudge would mislead. A failure here (older API, scope, network)
			// just omits the field rather than breaking the tour.
			let verified: boolean | null = null;
			let authType: string | null = null;
			if (credential.startsWith("ak_") && orpc) {
				try {
					const status = await orpc.agentSelfService.status({});
					authType = status.auth_type;
					verified = authType === "agent_verified" || authType === "claimed";
				} catch {
					// Verification status unavailable — leave it unknown.
				}
			}

			if (isAgent) {
				const verifyStep = {
					command: "anima verify <code>",
					description:
						"Verify with the OTP emailed to the agent's owner — unlocks full send capability",
				};
				output.payload({
					status: "ready",
					identity: {
						org_id: me.id,
						org_name: me.name,
						org_slug: me.slug,
						tier: me.tier,
						// Only present for agent keys where verification applies.
						...(verified !== null ? { verified, auth_type: authType } : {}),
					},
					next_steps: [
						// Lead with verification when the agent is still unverified.
						...(verified === false ? [verifyStep] : []),
						{
							command: "anima demo --only-email",
							description: "Test-mode email send + receive (no real emails)",
						},
						{
							command: "anima demo --only-x402",
							description: "x402 sandbox fetch (HTTP 402 settlement demo)",
						},
						{
							command: "anima setup-mcp install --all",
							description:
								"Wire Anima MCP to Claude Code, Claude Desktop, Cursor, Windsurf, VS Code",
						},
					],
					docs: "https://docs.useanima.sh/getting-started",
					skill_manifest: "https://useanima.sh/skill.md",
				});
				return;
			}

			// ── Human onboarding flow ──
			clack.intro("Welcome to Anima");
			clack.log.success(`Authenticated for ${me.name}`);
			clack.log.info(`Organization: ${me.name} (${me.id})`);
			clack.log.info(`Tier: ${me.tier}`);
			if (verified === true) {
				clack.log.success("Verified — full send capability unlocked.");
			} else if (verified === false) {
				clack.log.warn(
					"Not verified yet — run `anima verify <code>` (the code was emailed to the agent's owner).",
				);
			}

			// ── Step 3: Capability matrix ──
			clack.note(
				[
					"Email      send + receive, custom domains, DKIM/SPF/DMARC",
					"Phone      US numbers, SMS, voice (Telnyx/Deepgram/ElevenLabs)",
					"Vault      Bitwarden-backed secrets, egress-time injection, TOTP",
					"Addresses  USPS-validated billing/shipping",
					"x402/MPP   HTTP 402 settlement, machine payments protocol",
				].join("\n"),
				"What you can do",
			);

			// ── Step 4: Demos ──
			if (!opts.skipDemo) {
				const wantsDemo = await clack.confirm({
					message: "Run a quick test-mode demo? (no real charges/emails)",
					initialValue: true,
				});
				if (clack.isCancel(wantsDemo)) {
					clack.outro("See you later.");
					return;
				}
				if (wantsDemo) {
					const which = await clack.select({
						message: "Which flow?",
						options: [
							{
								value: "email",
								label: "Email send (test mode) — see the agent inbox in action",
							},
							{ value: "x402", label: "x402 fetch (sandbox) — pay for an API call" },
							{ value: "skip", label: "Skip" },
						],
					});
					if (clack.isCancel(which) || which === "skip") {
						// fall through to MCP step
					} else {
						clack.log.info(`Run: anima demo --only-${which}`);
					}
				}
			}

			// ── Step 5: MCP install ──
			if (!opts.skipMcp) {
				const wantsMcp = await clack.confirm({
					message:
						"Wire Anima as an MCP server in Claude Code / Claude Desktop / Cursor / Windsurf / VS Code?",
					initialValue: true,
				});
				if (!clack.isCancel(wantsMcp) && wantsMcp) {
					clack.log.info("Run: anima setup-mcp install --all");
				}
			}

			// ── Step 6: Summary ──
			clack.note(
				[
					`anima --help                     all commands`,
					`anima auth whoami                identity + CLI version + update info`,
					`anima demo                       runnable demos for every flow`,
					`anima setup-mcp install --all    MCP integration into your editor`,
					`Docs: https://docs.useanima.sh`,
					`Discord: https://discord.gg/pY3GK59Z9E`,
				].join("\n"),
				"Next steps",
			);
			clack.outro("Welcome aboard. ✸");
		});
}
