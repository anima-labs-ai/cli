/**
 * `anima onboard` — guided post-signup tour of agentic-commerce capabilities.
 *
 * Designed to mirror `link-cli onboard` from Stripe, but for Anima's multi-
 * channel surface (cards + email + phone + voice + vault). Targets the
 * developer who has just installed the CLI and wants to understand what
 * Anima can do.
 *
 * Flow:
 *   1. Verify authentication (offer `anima auth login` or `anima init` if not)
 *   2. Greet + show identity (whoami)
 *   3. Show capability matrix at the user's plan tier
 *   4. Offer to run quick demos in test mode (test card issue, test email send,
 *      x402 sandbox fetch). User opts in/out per demo.
 *   5. MCP install status — offer to wire Claude Code / Cursor / etc.
 *   6. Print summary with next-step commands.
 *
 * Test mode: every demo uses `--test` flag (Wave 2C) so no real charges, no
 * real emails sent, no real numbers provisioned.
 */

import * as clack from "@clack/prompts";
import { Command } from "commander";
import { ApiError } from "../../lib/api-client.js";
import { getApiClient } from "../../lib/auth.js";
import type { GlobalOptions } from "../../lib/auth.js";
import { getAuthConfig } from "../../lib/config.js";
import { Output } from "../../lib/output.js";

interface WhoamiResponse {
	email: string;
	orgId: string;
	orgName: string;
	role: string;
}

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
			const isAgent = !globals.human && globals.format !== "human";

			// ── Step 1: Auth check ──
			const auth = await getAuthConfig();
			if (!auth.token && !auth.apiKey) {
				if (isAgent) {
					output.payload({
						status: "needs_auth",
						next_command: "anima auth login",
						hint: "Run `anima init` for a guided sign-up if you don't have an Anima account yet.",
					});
					process.exit(1);
				}
				clack.intro("Anima onboarding");
				clack.log.error("You're not authenticated yet.");
				const choice = await clack.select({
					message: "How would you like to start?",
					options: [
						{ value: "login", label: "Log in (I have an Anima account)" },
						{ value: "init", label: "Sign up with anima init (new account)" },
						{ value: "quit", label: "Quit" },
					],
				});
				if (clack.isCancel(choice) || choice === "quit") {
					clack.outro("See you later.");
					return;
				}
				clack.outro(
					choice === "login"
						? "Run: anima auth login\nThen run: anima onboard"
						: "Run: anima init\n(this also offers to run onboard at the end)",
				);
				return;
			}

			// ── Step 2: Identity ──
			let me: WhoamiResponse | null = null;
			try {
				const client = await getApiClient(globals);
				me = await client.get<WhoamiResponse>("/auth/me");
			} catch (error) {
				if (error instanceof ApiError && error.status === 401) {
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

			if (isAgent) {
				output.payload({
					status: "ready",
					identity: {
						email: me.email,
						org_id: me.orgId,
						org_name: me.orgName,
						role: me.role,
					},
					next_steps: [
						{
							command: "anima demo --only-card",
							description:
								"Test-mode card issue + browser checkout flow (no real charges)",
						},
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
								"Wire Anima MCP to Claude Code, Cursor, Codex, Windsurf, Zed",
						},
					],
					docs: "https://docs.useanima.sh/getting-started",
					skill_manifest: "https://useanima.sh/skill.md",
				});
				return;
			}

			// ── Human onboarding flow ──
			clack.intro("Welcome to Anima");
			clack.log.success(`Logged in as ${me.email}`);
			clack.log.info(`Organization: ${me.orgName} (${me.orgId})`);
			clack.log.info(`Role: ${me.role}`);

			// ── Step 3: Capability matrix ──
			clack.note(
				[
					"Email      send + receive, custom domains, DKIM/SPF/DMARC",
					"Phone      US numbers, SMS, voice (Telnyx/Deepgram/ElevenLabs)",
					"Cards      Lithic-issued virtual cards, real-time ASA, MCC controls",
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
								value: "card",
								label:
									"Card issue (test mode) — see how a virtual card is provisioned",
							},
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
						"Wire Anima as an MCP server in Claude Code / Cursor / Codex / Windsurf / Zed?",
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
