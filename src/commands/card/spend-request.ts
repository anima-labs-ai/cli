/**
 * `anima card spend-request` — human-in-the-loop spend approval (Wave 3 placeholder).
 *
 * Wave 3 lands: `create`, `retrieve`, `request-approval`, `update`, with email
 * magic-link + webhook + passkey/WebAuthn step-up at $200.
 *
 * Until then: emit `coming_soon` payload so agents reading SKILL.md and trying
 * the documented flow get a clean structured response.
 */

import { Command } from "commander";
import type { GlobalOptions } from "../../lib/auth.js";
import { Output } from "../../lib/output.js";

function comingSoon(name: string) {
	return async function (this: Command) {
		const globals = this.optsWithGlobals<GlobalOptions>();
		const output = Output.fromGlobals(globals);
		output.payload({
			status: "coming_soon",
			command: `card spend-request ${name}`,
			expected_release: "Wave 3 — May 2026",
			docs: "https://useanima.sh/skill.md",
			tracking: "https://github.com/anima-labs-ai/cli/milestones",
			approval_design: {
				channels: ["email_magic_link", "webhook", "passkey_webauthn"],
				step_up_threshold_usd: 200,
				magic_link_ttl_minutes: 5,
			},
			workaround:
				"Until Wave 3 ships, use `anima card create` + `approve_authorization` / `decline_authorization` for legacy approval flow.",
		});
		process.exit(2);
	};
}

export function spendRequestCommands(): Command {
	const sr = new Command("spend-request").description(
		"Human-in-the-loop spend approval lifecycle (Wave 3, coming soon — create, retrieve, request-approval)",
	);

	sr
		.command("create")
		.description(
			"(Coming soon) Create a spend request. With --request-approval, sends email + webhook + (≥$200) passkey step-up.",
		)
		.option("--card-id <id>", "Card to draw from")
		.option("--amount <cents>", "Amount in cents")
		.option("--context <text>", "Full sentence describing the purchase (≥100 chars)")
		.option("--merchant-name <name>", "Merchant display name")
		.option("--merchant-url <url>", "Merchant URL")
		.option("--line-item <kv>", "Repeatable line item: name:X,unit_amount:Y,quantity:Z")
		.option("--total <kv>", "Repeatable total: type:total,display_text:Total,amount:Y")
		.option("--credential-type <type>", "card | shared_payment_token | x402", "card")
		.option("--request-approval", "Trigger approval flow immediately", false)
		.action(comingSoon("create"));

	sr
		.command("retrieve")
		.description("(Coming soon) Retrieve a spend request — polls for terminal state")
		.argument("[id]", "Spend request ID")
		.option("--include <fields>", "Comma-separated: card,spt")
		.option("--interval <s>", "Polling interval seconds", "2")
		.option("--max-attempts <n>", "Max polling attempts", "150")
		.option("--timeout <s>", "Polling timeout seconds")
		.action(comingSoon("retrieve"));

	sr
		.command("request-approval")
		.description(
			"(Coming soon) Trigger the approval flow on an already-created spend request",
		)
		.argument("[id]", "Spend request ID")
		.action(comingSoon("request-approval"));

	sr
		.command("update")
		.description("(Coming soon) Update a spend request before approval")
		.argument("[id]", "Spend request ID")
		.option("--merchant-url <url>", "Update merchant URL")
		.option("--context <text>", "Update context")
		.action(comingSoon("update"));

	return sr;
}
