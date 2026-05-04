/**
 * `anima mpp` — Machine Payments Protocol (Wave 3 placeholder).
 *
 * Wave 3 lands: `mpp pay` (settle x402/MPP request with shared payment token),
 * `mpp decode` (parse `WWW-Authenticate` challenge + return network_id).
 *
 * Until then: emit a structured `coming_soon` payload so agents calling these
 * commands get an actionable response instead of a Commander unknown-command
 * error.
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
			command: name,
			expected_release: "Wave 3 — May 2026",
			docs: "https://useanima.sh/skill.md",
			tracking: "https://github.com/anima-labs-ai/cli/milestones",
			workaround:
				"Until Wave 3 ships, use `anima x402 fetch <url>` for x402 settlement and `anima card create` for non-MPP card flows.",
		});
		process.exit(2);
	};
}

export function mppCommands(): Command {
	const mpp = new Command("mpp").description(
		"Machine Payments Protocol (Wave 3, coming soon — pay/decode for HTTP 402 with shared payment tokens)",
	);

	mpp
		.command("pay")
		.description(
			"(Coming soon) Settle a machine payment for an HTTP 402 endpoint using a shared payment token",
		)
		.argument("[url]", "URL that returned HTTP 402")
		.option("--spend-request-id <id>", "Spend request ID with credential_type=shared_payment_token")
		.option("--method <method>", "HTTP method", "POST")
		.option("--data <body>", "Request body (JSON)")
		.option("--header <kv>", "Extra header in 'Name: Value' form")
		.action(comingSoon("mpp pay"));

	mpp
		.command("decode")
		.description(
			"(Coming soon) Decode a WWW-Authenticate Payment challenge and return the extracted network_id",
		)
		.option("--challenge <header>", "Full WWW-Authenticate header value")
		.action(comingSoon("mpp decode"));

	return mpp;
}
