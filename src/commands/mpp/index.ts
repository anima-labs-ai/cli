/**
 * `anima mpp` — Machine Payments Protocol (Wave 3I).
 *
 *   anima mpp pay <url> --spend-request-id <id> [--method POST] [--data <json>] [--header "K: V"]
 *     → POST /v1/mpp/pay  (or /v1/x402/fetch when credential type is X402)
 *     → API handles: probe URL, parse WWW-Authenticate, build
 *       Authorization: Payment header using SPT, retry with the auth.
 *     → SPT is one-time-use; if payment fails, agent must create a new
 *       spend request.
 *
 *   anima mpp decode --challenge "<full WWW-Authenticate header>"
 *     → POST /v1/mpp/decode
 *     → returns extracted network_id + decoded request payload.
 */

import { Command, InvalidArgumentError } from "commander";
import { ApiError } from "../../lib/api-client.js";
import { requireAuth, type GlobalOptions } from "../../lib/auth.js";
import { Output } from "../../lib/output.js";

interface MppPayResponse {
	paid: boolean;
	settlement?: {
		network_id?: string;
		amount_cents?: number;
		currency?: string;
	};
	response?: {
		status?: number;
		body?: unknown;
	};
	[k: string]: unknown;
}

interface MppDecodeResponse {
	network_id: string;
	method: string;
	request: Record<string, unknown>;
	[k: string]: unknown;
}

function collectHeader(value: string, previous: Record<string, string> = {}) {
	const idx = value.indexOf(":");
	if (idx <= 0) {
		throw new InvalidArgumentError(`header must be "Name: Value"; got "${value}"`);
	}
	const name = value.slice(0, idx).trim();
	const v = value.slice(idx + 1).trim();
	previous[name] = v;
	return previous;
}

function payCmd(): Command {
	return new Command("pay")
		.description(
			"Settle a machine payment for an HTTP 402 endpoint using a shared payment token",
		)
		.argument("<url>", "URL that returned HTTP 402")
		.requiredOption(
			"--spend-request-id <id>",
			"Spend request ID with credential_type=SHARED_PAYMENT_TOKEN (and APPROVED)",
		)
		.option("--method <method>", "HTTP method", "POST")
		.option("--data <body>", "JSON body for the upstream request")
		.option(
			"--header <kv>",
			'Extra header in "Name: Value" form (repeatable)',
			collectHeader,
			{} as Record<string, string>,
		)
		.action(async function (this: Command, url: string) {
			const opts = this.opts<{
				spendRequestId: string;
				method: string;
				data?: string;
				header: Record<string, string>;
			}>();
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);
			try {
				const client = await requireAuth(globals);
				let parsedData: unknown;
				if (opts.data) {
					try {
						parsedData = JSON.parse(opts.data);
					} catch {
						throw new InvalidArgumentError(
							"--data must be valid JSON; wrap strings in quotes (e.g. '\"hello\"')",
						);
					}
				}
				const result = await client.post<MppPayResponse>("/v1/mpp/pay", {
					url,
					spend_request_id: opts.spendRequestId,
					method: opts.method,
					data: parsedData,
					headers: opts.header,
				});
				output.payload(result);
			} catch (error) {
				if (error instanceof ApiError) {
					output.error(`mpp pay failed: ${error.message}`);
				} else if (error instanceof Error) {
					output.error(error.message);
				}
				process.exit(1);
			}
		});
}

function decodeCmd(): Command {
	return new Command("decode")
		.description(
			"Decode a WWW-Authenticate Payment challenge and return the extracted network_id",
		)
		.requiredOption(
			"--challenge <header>",
			'Full WWW-Authenticate header value (may contain multiple challenges)',
		)
		.action(async function (this: Command) {
			const opts = this.opts<{ challenge: string }>();
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);
			try {
				const client = await requireAuth(globals);
				const result = await client.post<MppDecodeResponse>("/v1/mpp/decode", {
					challenge: opts.challenge,
				});
				output.payload(result);
			} catch (error) {
				if (error instanceof ApiError) {
					output.error(`mpp decode failed: ${error.message}`);
				} else if (error instanceof Error) {
					output.error(error.message);
				}
				process.exit(1);
			}
		});
}

export function mppCommands(): Command {
	const mpp = new Command("mpp").description(
		"Machine Payments Protocol (HTTP 402 settlement with shared payment tokens)",
	);
	mpp.addCommand(payCmd());
	mpp.addCommand(decodeCmd());
	return mpp;
}
