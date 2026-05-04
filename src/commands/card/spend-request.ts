/**
 * `anima card spend-request` — human-in-the-loop spend approval (Wave 3G).
 *
 * Lifecycle:
 *   anima card spend-request create [--request-approval]
 *     → POST /v1/spend-requests
 *     → if --request-approval: server emails the cardholder, returns
 *       PENDING_APPROVAL with `_next.command` polling hint
 *
 *   anima card spend-request request-approval <id>
 *     → POST /v1/spend-requests/{id}/request-approval
 *     → triggers email + sets state to PENDING_APPROVAL
 *
 *   anima card spend-request retrieve <id> [--include card,spt]
 *     → GET /v1/spend-requests/{id}
 *     → Polls when --interval is set, exits non-zero with code
 *       POLLING_TIMEOUT if still non-terminal at --max-attempts.
 *
 *   anima card spend-request update <id> [--merchant-name|--merchant-url|--context]
 *     → PATCH /v1/spend-requests/{id}
 *     → only valid in CREATED state
 *
 *   anima card spend-request list [--status|--card-id|--cardholder-id|--limit|--cursor]
 *     → GET /v1/spend-requests
 */

import { Command, InvalidArgumentError } from "commander";
import { ApiError } from "../../lib/api-client.js";
import { requireAuth, type GlobalOptions } from "../../lib/auth.js";
import { Output } from "../../lib/output.js";

interface SpendRequestPayload {
	id: string;
	status:
		| "CREATED"
		| "PENDING_APPROVAL"
		| "APPROVED"
		| "DENIED"
		| "EXPIRED"
		| "CONSUMED";
	approval_url?: string | null;
	[key: string]: unknown;
}

interface ListPayload {
	items: SpendRequestPayload[];
	next_cursor: string | null;
	has_more: boolean;
}

const TERMINAL: ReadonlyArray<SpendRequestPayload["status"]> = [
	"APPROVED",
	"DENIED",
	"EXPIRED",
	"CONSUMED",
];

function parseLineItem(value: string): Record<string, string | number> {
	const parts = value.split(",");
	const out: Record<string, string | number> = {};
	for (const p of parts) {
		const [k, ...rest] = p.split(":");
		const v = rest.join(":");
		if (!k || !v) continue;
		const key = k.trim();
		if (key === "quantity" || key === "unit_amount") {
			const n = Number.parseInt(v.trim(), 10);
			if (!Number.isFinite(n)) {
				throw new InvalidArgumentError(`${key} must be an integer; got "${v}"`);
			}
			out[key] = n;
		} else {
			out[key] = v.trim();
		}
	}
	if (!out.name) {
		throw new InvalidArgumentError(
			'line-item requires "name:" key, e.g. --line-item "name:Item,unit_amount:1500,quantity:1"',
		);
	}
	return out;
}

function parseTotal(value: string): Record<string, string | number> {
	const out = parseLineItem(value);
	// `name` is not required for totals; instead `type`, `display_text`, `amount`.
	delete out.name;
	const parts = value.split(",");
	for (const p of parts) {
		const [k, ...rest] = p.split(":");
		const v = rest.join(":");
		if (!k || !v) continue;
		const key = k.trim();
		if (key === "amount") {
			const n = Number.parseInt(v.trim(), 10);
			if (!Number.isFinite(n)) {
				throw new InvalidArgumentError(`amount must be an integer; got "${v}"`);
			}
			out.amount = n;
		} else {
			out[key] = v.trim();
		}
	}
	if (!out.type || !out.display_text || out.amount === undefined) {
		throw new InvalidArgumentError(
			'total requires "type:", "display_text:", and "amount:" keys',
		);
	}
	return out;
}

function collect<T>(parser: (v: string) => T) {
	return (value: string, previous: T[] = []): T[] => {
		previous.push(parser(value));
		return previous;
	};
}

async function pollUntilTerminal(opts: {
	id: string;
	intervalSec: number;
	maxAttempts: number;
	timeoutSec?: number;
	include: string[];
	globals: GlobalOptions;
}): Promise<{ ok: true; data: SpendRequestPayload } | { ok: false; reason: string }> {
	const client = await requireAuth(opts.globals);
	const startedAt = Date.now();
	for (let i = 0; i < opts.maxAttempts; i++) {
		const params: Record<string, string> = {};
		if (opts.include.length > 0) params.include = opts.include.join(",");
		const sr = await client.get<SpendRequestPayload>(
			`/v1/spend-requests/${encodeURIComponent(opts.id)}`,
			params,
		);
		if (TERMINAL.includes(sr.status)) {
			return { ok: true, data: sr };
		}
		if (opts.timeoutSec && (Date.now() - startedAt) / 1000 >= opts.timeoutSec) {
			return { ok: false, reason: "TIMEOUT" };
		}
		await new Promise((resolve) => setTimeout(resolve, opts.intervalSec * 1000));
	}
	return { ok: false, reason: "MAX_ATTEMPTS" };
}

function createSpendRequestCmd(): Command {
	return new Command("create")
		.description(
			"Create a spend request (one-time-use credential after cardholder approval)",
		)
		.requiredOption("--card-id <id>", "Card to draw from")
		.requiredOption("--amount <cents>", "Amount in cents", (v) => {
			const n = Number.parseInt(v, 10);
			if (!Number.isInteger(n) || n <= 0)
				throw new InvalidArgumentError("amount must be a positive integer (cents)");
			return n;
		})
		.requiredOption(
			"--context <text>",
			"Full sentence describing what is being purchased and why (≥100 chars)",
		)
		.requiredOption("--cardholder-id <id>", "Cardholder who will approve")
		.requiredOption("--agent-id <id>", "Agent creating the request")
		.option("--currency <code>", "ISO 4217 currency code", "usd")
		.option("--merchant-name <name>", "Merchant display name")
		.option("--merchant-url <url>", "Merchant URL")
		.option(
			"--line-item <kv>",
			'Line item: "name:X,unit_amount:Y,quantity:Z" (repeatable)',
			collect(parseLineItem),
			[] as Array<Record<string, string | number>>,
		)
		.option(
			"--total <kv>",
			'Total: "type:total,display_text:Total,amount:Y" (repeatable)',
			collect(parseTotal),
			[] as Array<Record<string, string | number>>,
		)
		.option(
			"--credential-type <type>",
			"CARD | SHARED_PAYMENT_TOKEN | X402",
			(v) => {
				const allowed = ["CARD", "SHARED_PAYMENT_TOKEN", "X402"];
				if (!allowed.includes(v))
					throw new InvalidArgumentError(`credential-type must be one of ${allowed.join(", ")}`);
				return v;
			},
			"CARD",
		)
		.option(
			"--request-approval",
			"Trigger email magic-link + webhook approval flow on creation",
			false,
		)
		.option("--expires-in-minutes <n>", "Expiration in minutes (1–1440)", "60")
		.action(async function (this: Command) {
			const opts = this.opts<{
				cardId: string;
				amount: number;
				context: string;
				cardholderId: string;
				agentId: string;
				currency: string;
				merchantName?: string;
				merchantUrl?: string;
				lineItem: Array<Record<string, string | number>>;
				total: Array<Record<string, string | number>>;
				credentialType: string;
				requestApproval: boolean;
				expiresInMinutes: string;
			}>();
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);

			try {
				const client = await requireAuth(globals);
				const created = await client.post<SpendRequestPayload>("/v1/spend-requests", {
					card_id: opts.cardId,
					amount_cents: opts.amount,
					context: opts.context,
					cardholder_id: opts.cardholderId,
					agent_id: opts.agentId,
					currency: opts.currency,
					merchant_name: opts.merchantName,
					merchant_url: opts.merchantUrl,
					line_items: opts.lineItem,
					totals: opts.total,
					credential_type: opts.credentialType,
					request_approval: opts.requestApproval,
					expires_in_minutes: Number.parseInt(opts.expiresInMinutes, 10),
				});
				output.payload(created);
			} catch (error) {
				handleError(error, output, "Failed to create spend request");
			}
		});
}

function retrieveSpendRequestCmd(): Command {
	return new Command("retrieve")
		.description(
			"Retrieve a spend request. With --interval, poll until terminal status.",
		)
		.argument("<id>", "Spend request ID")
		.option(
			"--include <fields>",
			"Comma-separated sensitive fields: card,spt,x402_token (only valid post-approval)",
		)
		.option("--interval <seconds>", "Polling interval in seconds")
		.option("--max-attempts <n>", "Max polling attempts", "150")
		.option("--timeout <seconds>", "Polling timeout in seconds")
		.action(async function (this: Command, id: string) {
			const opts = this.opts<{
				include?: string;
				interval?: string;
				maxAttempts?: string;
				timeout?: string;
			}>();
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);

			try {
				const include = opts.include ? opts.include.split(",").map((s) => s.trim()) : [];
				if (opts.interval) {
					const intervalSec = Number.parseInt(opts.interval, 10);
					const maxAttempts = Number.parseInt(opts.maxAttempts ?? "150", 10);
					const timeoutSec = opts.timeout ? Number.parseInt(opts.timeout, 10) : undefined;
					const result = await pollUntilTerminal({
						id,
						intervalSec,
						maxAttempts,
						timeoutSec,
						include,
						globals,
					});
					if (!result.ok) {
						output.payload({
							code: "POLLING_TIMEOUT",
							reason: result.reason,
							hint: "Increase --max-attempts or --timeout, or wait and retry without --interval to fetch the latest snapshot.",
						});
						process.exit(2);
					}
					output.payload(result.data);
					return;
				}

				const client = await requireAuth(globals);
				const params: Record<string, string> = {};
				if (include.length > 0) params.include = include.join(",");
				const sr = await client.get<SpendRequestPayload>(
					`/v1/spend-requests/${encodeURIComponent(id)}`,
					params,
				);
				output.payload(sr);
			} catch (error) {
				handleError(error, output, "Failed to retrieve spend request");
			}
		});
}

function requestApprovalCmd(): Command {
	return new Command("request-approval")
		.description("Trigger the approval flow on an already-created spend request")
		.argument("<id>", "Spend request ID")
		.action(async function (this: Command, id: string) {
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);
			try {
				const client = await requireAuth(globals);
				const sr = await client.post<SpendRequestPayload>(
					`/v1/spend-requests/${encodeURIComponent(id)}/request-approval`,
					{},
				);
				output.payload(sr);
			} catch (error) {
				handleError(error, output, "Failed to request approval");
			}
		});
}

function updateSpendRequestCmd(): Command {
	return new Command("update")
		.description("Update a CREATED spend request before approval is requested")
		.argument("<id>", "Spend request ID")
		.option("--merchant-name <name>")
		.option("--merchant-url <url>")
		.option("--context <text>")
		.action(async function (this: Command, id: string) {
			const opts = this.opts<{
				merchantName?: string;
				merchantUrl?: string;
				context?: string;
			}>();
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);
			try {
				const client = await requireAuth(globals);
				const updated = await client.patch<SpendRequestPayload>(
					`/v1/spend-requests/${encodeURIComponent(id)}`,
					{
						merchant_name: opts.merchantName,
						merchant_url: opts.merchantUrl,
						context: opts.context,
					},
				);
				output.payload(updated);
			} catch (error) {
				handleError(error, output, "Failed to update spend request");
			}
		});
}

function listSpendRequestsCmd(): Command {
	return new Command("list")
		.description("List spend requests in the current org")
		.option(
			"--status <status>",
			"Filter by status (CREATED|PENDING_APPROVAL|APPROVED|DENIED|EXPIRED|CONSUMED)",
		)
		.option("--card-id <id>")
		.option("--cardholder-id <id>")
		.option("--agent-id <id>")
		.option("--limit <n>", "Page size 1–100", "20")
		.option("--cursor <cursor>", "Pagination cursor")
		.action(async function (this: Command) {
			const opts = this.opts<{
				status?: string;
				cardId?: string;
				cardholderId?: string;
				agentId?: string;
				limit?: string;
				cursor?: string;
			}>();
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);
			try {
				const client = await requireAuth(globals);
				const params: Record<string, string> = {};
				if (opts.status) params.status = opts.status;
				if (opts.cardId) params.card_id = opts.cardId;
				if (opts.cardholderId) params.cardholder_id = opts.cardholderId;
				if (opts.agentId) params.agent_id = opts.agentId;
				if (opts.limit) params.limit = opts.limit;
				if (opts.cursor) params.cursor = opts.cursor;
				const result = await client.get<ListPayload>("/v1/spend-requests", params);
				output.table(
					["ID", "Status", "Amount", "Currency", "Merchant"],
					result.items.map((sr) => [
						sr.id,
						sr.status,
						String((sr as { amount_cents?: number }).amount_cents ?? ""),
						String((sr as { currency?: string }).currency ?? ""),
						String((sr as { merchant_name?: string }).merchant_name ?? "—"),
					]),
					{
						pagination: {
							has_more: result.has_more,
							next_cursor: result.next_cursor,
						},
						summary: `${result.items.length} spend request(s)`,
					},
				);
			} catch (error) {
				handleError(error, output, "Failed to list spend requests");
			}
		});
}

function handleError(error: unknown, output: Output, prefix: string): never {
	if (error instanceof ApiError) {
		output.error(`${prefix}: ${error.message}`);
	} else if (error instanceof Error) {
		output.error(error.message);
	} else {
		output.error(String(error));
	}
	process.exit(1);
}

export function spendRequestCommands(): Command {
	const sr = new Command("spend-request").description(
		"Human-in-the-loop spend approval (create, retrieve, request-approval, update, list)",
	);
	sr.addCommand(createSpendRequestCmd());
	sr.addCommand(retrieveSpendRequestCmd());
	sr.addCommand(requestApprovalCmd());
	sr.addCommand(updateSpendRequestCmd());
	sr.addCommand(listSpendRequestsCmd());
	return sr;
}

// Backwards-compat alias for the import in card/index.ts
export const spendRequestCommands_v2 = spendRequestCommands;
