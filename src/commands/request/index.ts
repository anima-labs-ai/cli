/**
 * `am request` — ask the org owner to provision something this agent cannot
 * provision for itself.
 *
 * Distinct from `am vault request`, which asks a human to TYPE A SECRET the
 * agent must never see. This asks for a DECISION: `vault provision` and
 * `phone provision` are master-gated, and an agent key never holds master
 * authority, so an agent that needs a vault after sign-up has no other way to
 * get one. (`am init` offers the first vault; everything after it comes here.)
 *
 * `approve`/`decline` live here too, but they need a master credential — the
 * same gate as the underlying provisioning endpoints. An agent can open the
 * conversation and withdraw from it, never conclude it.
 */

import { Command, InvalidArgumentError } from "commander";
import { ApiError } from "../../lib/api-client.js";
import { requireNonEmptyArg } from "../../lib/args.js";
import { type GlobalOptions, requireAuth } from "../../lib/auth.js";
import { Output } from "../../lib/output.js";

type RequestStatus =
	| "PENDING"
	| "APPROVED"
	| "DECLINED"
	| "EXPIRED"
	| "CANCELLED";
type Resource = "VAULT" | "PHONE_NUMBER";

const STATUSES: readonly RequestStatus[] = [
	"PENDING",
	"APPROVED",
	"DECLINED",
	"EXPIRED",
	"CANCELLED",
];

interface ProvisioningRequest {
	requestId: string;
	agentId: string;
	agentName: string;
	resource: Resource;
	reason: string;
	status: RequestStatus;
	options: { countryCode?: string; areaCode?: string } | null;
	expiresAt: string;
	decidedAt: string | null;
	decidedNote: string | null;
	provisionedId: string | null;
	createdAt: string;
	emailSent?: boolean;
}

const BASE = "/v1/provisioning-requests";

function validateStatus(value: string): RequestStatus {
	const upper = value.toUpperCase();
	if ((STATUSES as readonly string[]).includes(upper))
		return upper as RequestStatus;
	throw new InvalidArgumentError(
		`status must be one of ${STATUSES.join(", ")}`,
	);
}

function validateCountry(value: string): string {
	if (!/^[A-Za-z]{2}$/.test(value)) {
		throw new InvalidArgumentError(
			"country must be a 2-letter ISO code, e.g. US",
		);
	}
	return value.toUpperCase();
}

function validateAreaCode(value: string): string {
	if (!/^\d{3}$/.test(value)) {
		throw new InvalidArgumentError("area-code must be exactly 3 digits");
	}
	return value;
}

function handleError(output: Output, error: unknown, action: string): never {
	if (error instanceof ApiError) {
		if (error.status === 401) {
			output.error("Not authenticated. Run `am auth login` to authenticate.");
		} else if (error.status === 402) {
			output.error(`Plan limit: ${error.message}`);
		} else if (error.status === 403) {
			// The single most likely mistake with approve/decline, and the message
			// has to name the fix rather than just the refusal.
			output.error(
				`${error.message} (approve/decline need a master credential — use an mk_ key, or run this from an interactive terminal where it can ask for admin access)`,
			);
		} else if (error.status === 404) {
			output.error("Provisioning request not found.");
		} else {
			output.error(`Failed to ${action}: ${error.message}`);
		}
	} else if (error instanceof Error) {
		output.error(`Failed to ${action}: ${error.message}`);
	}
	process.exit(1);
}

function printRequest(output: Output, req: ProvisioningRequest): void {
	output.details([
		["Request", req.requestId],
		["Agent", `${req.agentName} (${req.agentId})`],
		["Wants", req.resource],
		["Reason", req.reason],
		["Status", req.status],
		["Expires", req.expiresAt],
		["Provisioned", req.provisionedId ?? "(nothing yet)"],
		["Owner note", req.decidedNote ?? "(none)"],
	]);
}

// ---------------------------------------------------------------------------
// am request vault / am request phone
// ---------------------------------------------------------------------------

interface CreateOptions {
	agent?: string;
	reason: string;
	country?: string;
	areaCode?: string;
}

async function createRequest(
	command: Command,
	resource: Resource,
	buildOptions: (opts: CreateOptions) => Record<string, string> | undefined,
): Promise<void> {
	const opts = command.opts<CreateOptions>();
	const globals = command.optsWithGlobals<GlobalOptions>();
	const output = Output.fromGlobals(globals);

	try {
		const client = await requireAuth(globals);
		const created = await client.post<ProvisioningRequest>(BASE, {
			agentId: opts.agent,
			resource,
			reason: opts.reason,
			options: buildOptions(opts),
		});

		if (output.isMachineFormat()) {
			output.json(created);
			return;
		}
		output.success(
			`Asked your owner for ${resource === "VAULT" ? "a vault" : "a phone number"}`,
		);
		printRequest(output, created);
		// `emailSent: false` is not a failure — the request is live and visible in
		// the console either way — but the agent should not assume a human was
		// told, so say which happened.
		if (created.emailSent) {
			output.success("Your owner was emailed a link to approve or decline.");
		} else {
			output.warn(
				"No owner email went out (none on file, or delivery failed). The request is still live in the console.",
			);
		}
	} catch (error: unknown) {
		handleError(output, error, "create provisioning request");
	}
}

function requestVaultCommand(): Command {
	return new Command("vault")
		.description(
			"Ask your owner to provision an encrypted vault for this agent",
		)
		.option(
			"--agent <id>",
			"Agent ID (optional with an agent-bound key)",
			requireNonEmptyArg("Agent ID"),
		)
		.requiredOption(
			"--reason <reason>",
			"Why you need it — shown verbatim to your owner",
		)
		.action(async function (this: Command) {
			await createRequest(this, "VAULT", () => undefined);
		});
}

function requestPhoneCommand(): Command {
	return new Command("phone")
		.description(
			"Ask your owner to provision a phone number (Starter+ plan required)",
		)
		.option(
			"--agent <id>",
			"Agent ID (optional with an agent-bound key)",
			requireNonEmptyArg("Agent ID"),
		)
		.requiredOption(
			"--reason <reason>",
			"Why you need it — shown verbatim to your owner",
		)
		.option(
			"--country <code>",
			"2-letter ISO country code (default US)",
			validateCountry,
		)
		.option(
			"--area-code <code>",
			"Preferred 3-digit area code",
			validateAreaCode,
		)
		.action(async function (this: Command) {
			await createRequest(this, "PHONE_NUMBER", (opts) => {
				const options: Record<string, string> = {};
				if (opts.country) options.countryCode = opts.country;
				if (opts.areaCode) options.areaCode = opts.areaCode;
				return Object.keys(options).length > 0 ? options : undefined;
			});
		});
}

// ---------------------------------------------------------------------------
// am request list / status / cancel
// ---------------------------------------------------------------------------

function requestListCommand(): Command {
	return new Command("list")
		.description("List provisioning requests (agents see only their own)")
		.option(
			"--status <status>",
			`Filter by status: ${STATUSES.join(", ")}`,
			validateStatus,
		)
		.option(
			"--agent <id>",
			"Filter by agent (org credentials only)",
			requireNonEmptyArg("Agent ID"),
		)
		.action(async function (this: Command) {
			const opts = this.opts<{ status?: RequestStatus; agent?: string }>();
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);

			try {
				const client = await requireAuth(globals);
				const query = new URLSearchParams();
				if (opts.status) query.set("status", opts.status);
				if (opts.agent) query.set("agentId", opts.agent);
				const suffix = query.toString() ? `?${query.toString()}` : "";
				const result = await client.get<{ items: ProvisioningRequest[] }>(
					`${BASE}${suffix}`,
				);

				if (output.isMachineFormat()) {
					output.json(result);
					return;
				}
				if (result.items.length === 0) {
					output.success("No provisioning requests.");
					return;
				}
				// `table`, not `info`: info renders in the human format only, so every
				// non-TTY caller would get a heading and no rows.
				output.table(
					["Request", "Agent", "Wants", "Status", "Reason"],
					result.items.map((r) => [
						r.requestId,
						r.agentName,
						r.resource,
						r.status,
						r.reason,
					]),
				);
			} catch (error: unknown) {
				handleError(output, error, "list provisioning requests");
			}
		});
}

function requestStatusCommand(): Command {
	return new Command("status")
		.description("Check one provisioning request")
		.argument(
			"<requestId>",
			"Provisioning request ID",
			requireNonEmptyArg("Provisioning request ID"),
		)
		.action(async function (this: Command, requestId: string) {
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);

			try {
				const client = await requireAuth(globals);
				const req = await client.get<ProvisioningRequest>(
					`${BASE}/${encodeURIComponent(requestId)}`,
				);

				if (output.isMachineFormat()) {
					output.json(req);
				} else {
					printRequest(output, req);
				}
				// Outside the format branch on purpose. The whole point of the exit
				// code is that an agent can gate on it — `am request status $ID && …`
				// — and the agent format is the DEFAULT for every non-TTY caller. An
				// early return inside the machine branch would make a decline exit 0
				// for exactly the callers who rely on it, which is how four vault
				// commands came to report success they had not achieved.
				if (req.status !== "PENDING" && req.status !== "APPROVED")
					process.exit(1);
			} catch (error: unknown) {
				handleError(output, error, "get provisioning request");
			}
		});
}

function requestCancelCommand(): Command {
	return new Command("cancel")
		.description("Withdraw a pending request you no longer need")
		.argument(
			"<requestId>",
			"Provisioning request ID",
			requireNonEmptyArg("Provisioning request ID"),
		)
		.action(async function (this: Command, requestId: string) {
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);

			try {
				const client = await requireAuth(globals);
				const req = await client.post<ProvisioningRequest>(
					`${BASE}/${encodeURIComponent(requestId)}/cancel`,
				);
				if (output.isMachineFormat()) {
					output.json(req);
					return;
				}
				output.success(`Request ${req.status.toLowerCase()}`);
			} catch (error: unknown) {
				handleError(output, error, "cancel provisioning request");
			}
		});
}

// ---------------------------------------------------------------------------
// am request approve / decline (master credential required)
// ---------------------------------------------------------------------------

function decideCommand(kind: "approve" | "decline"): Command {
	const isApprove = kind === "approve";
	return new Command(kind)
		.description(
			isApprove
				? "Approve a request and provision the resource (master credential required)"
				: "Decline a request — soft, the agent may ask again (master credential required)",
		)
		.argument(
			"<requestId>",
			"Provisioning request ID",
			requireNonEmptyArg("Provisioning request ID"),
		)
		.option(
			"--note <note>",
			"Note for the agent — say why, so a retry can address it",
		)
		.action(async function (this: Command, requestId: string) {
			const opts = this.opts<{ note?: string }>();
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);

			try {
				const client = await requireAuth(globals);
				const req = await client.post<ProvisioningRequest>(
					`${BASE}/${encodeURIComponent(requestId)}/${kind}`,
					{ requestId, ...(opts.note ? { note: opts.note } : {}) },
				);

				if (output.isMachineFormat()) {
					output.json(req);
					return;
				}
				if (isApprove) {
					output.success(
						`Approved — provisioned ${req.provisionedId} for ${req.agentName}`,
					);
				} else {
					output.success(
						`Declined — ${req.agentName} can ask again with a better reason`,
					);
				}
				printRequest(output, req);
			} catch (error: unknown) {
				handleError(output, error, `${kind} provisioning request`);
			}
		});
}

export function requestCommands(): Command {
	const cmd = new Command("request").description(
		"Ask your owner to provision a vault or phone number (they approve in the console)",
	);
	cmd.addCommand(requestVaultCommand());
	cmd.addCommand(requestPhoneCommand());
	cmd.addCommand(requestListCommand());
	cmd.addCommand(requestStatusCommand());
	cmd.addCommand(requestCancelCommand());
	cmd.addCommand(decideCommand("approve"));
	cmd.addCommand(decideCommand("decline"));
	return cmd;
}
