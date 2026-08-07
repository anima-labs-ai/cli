/**
 * `am permissions` — the owner's standing decisions about what an agent may do
 * unattended.
 *
 * The other half of `am request`. That command is the agent's side: it files an
 * ask and waits. This is the owner's side, and it is where a decision becomes
 * permanent — approving "always" in the queue is irreversible without it,
 * because standing grants do not expire.
 *
 * Master-only, and not by accident. Both endpoints sit on the escalation floor:
 * an agent that could READ this learns the exact inventory of operations worth
 * trying to escalate into, and one that could WRITE it would grant itself
 * everything in a single call. So there is no agent-key path here, and no
 * `--agent` defaulting from an agent-bound key — the agent is always named
 * explicitly by a human.
 *
 * Nothing here executes a procedure. A row records what the agent MAY do; the
 * agent still issues its own call.
 */

import { Command, InvalidArgumentError } from "commander";
import { ApiError } from "../../lib/api-client.js";
import { requireNonEmptyArg } from "../../lib/args.js";
import { type GlobalOptions, requireAuth } from "../../lib/auth.js";
import { Output } from "../../lib/output.js";

type PermissionState = "ASK" | "ALWAYS_ALLOW" | "NEVER";
type ProcedureGroup = "read" | "write" | "destructive";

interface PermissionRow {
	procedurePath: string;
	group: ProcedureGroup;
	state: PermissionState;
	grantedBy: string | null;
	updatedAt: string | null;
}

interface PermissionList {
	agentId: string;
	items: PermissionRow[];
	bypassReads: boolean;
}

const GROUPS: readonly ProcedureGroup[] = ["read", "write", "destructive"];

/**
 * What a human types, and what the API stores.
 *
 * `always` and `never` are the words the console uses on its buttons, and
 * ALWAYS_ALLOW is not a thing anyone wants to type. Accepted case-insensitively
 * — nobody should have to remember whether this one shouts.
 */
const STATES: Readonly<Record<string, PermissionState>> = {
	ask: "ASK",
	always: "ALWAYS_ALLOW",
	always_allow: "ALWAYS_ALLOW",
	never: "NEVER",
};

function base(agentId: string): string {
	return `/v1/agents/${encodeURIComponent(agentId)}/permissions`;
}

function validateState(value: string): PermissionState {
	const state = STATES[value.toLowerCase()];
	if (!state) {
		throw new InvalidArgumentError("state must be one of ask, always, never");
	}
	return state;
}

function validateGroup(value: string): ProcedureGroup {
	const group = value.toLowerCase();
	if (!(GROUPS as readonly string[]).includes(group)) {
		throw new InvalidArgumentError(`group must be one of ${GROUPS.join(", ")}`);
	}
	return group as ProcedureGroup;
}

function validateToggle(value: string): boolean {
	const lower = value.toLowerCase();
	if (lower === "on" || lower === "true") return true;
	if (lower === "off" || lower === "false") return false;
	throw new InvalidArgumentError("expected on or off");
}

function handleError(output: Output, error: unknown, action: string): never {
	if (error instanceof ApiError) {
		if (error.status === 401) {
			output.error("Not authenticated. Run `am auth login` to authenticate.");
		} else if (error.status === 403) {
			// The single most likely mistake here. An agent key can never do this,
			// so "you are not authenticated" would be actively misleading — the
			// caller IS authenticated, as the wrong kind of principal.
			output.error(
				`${error.message} (agent permissions are owner-only — use an mk_ key, or run this from an interactive terminal where it can ask for admin access)`,
			);
		} else if (error.status === 404) {
			output.error("No such agent in this organization.");
		} else if (error.status === 422) {
			// The server names the procedure and says why. Passing its message
			// through unchanged matters: "not a procedure you can set a standing
			// decision for" covers both a typo and an escalation-floor procedure,
			// and the distinction is the server's to explain, not ours to guess.
			output.error(error.message);
		} else {
			output.error(`Failed to ${action}: ${error.message}`);
		}
	} else if (error instanceof Error) {
		output.error(`Failed to ${action}: ${error.message}`);
	}
	process.exit(1);
}

// ---------------------------------------------------------------------------
// am permissions list
// ---------------------------------------------------------------------------

function listCommand(): Command {
	return new Command("list")
		.description("Show what an agent may do without asking you")
		.argument("<agentId>", "Agent to inspect", requireNonEmptyArg("Agent ID"))
		.option("--group <group>", `Only ${GROUPS.join(", ")}`, validateGroup)
		.option("--all", "Include procedures you have never decided (a long list)")
		.action(async function (this: Command, agentId: string) {
			const opts = this.opts<{ group?: ProcedureGroup; all?: boolean }>();
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);

			try {
				const client = await requireAuth(globals);
				const result = await client.get<PermissionList>(base(agentId));

				// Machine callers get everything, always. Filtering for terminal
				// legibility must not silently shrink a scripted read.
				if (output.isMachineFormat()) {
					output.json(result);
					return;
				}

				const inGroup = opts.group
					? result.items.filter((row) => row.group === opts.group)
					: result.items;
				// Decided-only by default: every master-gated procedure is listed,
				// which is ~100 rows, and the ones an owner has actually acted on are
				// what they came to see.
				const shown = opts.all
					? inGroup
					: inGroup.filter((row) => row.state !== "ASK");

				output.info(
					`Bypass for read-only operations: ${result.bypassReads ? "ON" : "off"}`,
				);

				if (shown.length === 0) {
					output.success(
						opts.all
							? "No matching procedures."
							: "Nothing set — this agent asks about everything. Use --all to see what you can decide.",
					);
					return;
				}

				output.table(
					["Procedure", "Group", "Decision", "Set by"],
					shown.map((row) => [
						row.procedurePath,
						row.group,
						row.state,
						row.grantedBy ?? "-",
					]),
				);

				const hidden = inGroup.length - shown.length;
				if (hidden > 0) {
					output.info(
						`${hidden} more you have not decided; they ask each time. Use --all to list them.`,
					);
				}
			} catch (error: unknown) {
				handleError(output, error, "read agent permissions");
			}
		});
}

// ---------------------------------------------------------------------------
// am permissions set / bypass
// ---------------------------------------------------------------------------

function setCommand(): Command {
	return new Command("set")
		.description("Decide one procedure: ask, always or never")
		.argument("<agentId>", "Agent to change", requireNonEmptyArg("Agent ID"))
		.argument(
			"<procedure>",
			"Dotted procedure path, e.g. agent.delete",
			requireNonEmptyArg("Procedure path"),
		)
		.argument("<state>", "ask, always or never", validateState)
		.action(async function (
			this: Command,
			agentId: string,
			procedurePath: string,
			state: PermissionState,
		) {
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);

			try {
				const client = await requireAuth(globals);
				const result = await client.post<PermissionList>(base(agentId), {
					agentId,
					procedurePath,
					state,
				});

				if (output.isMachineFormat()) {
					output.json(result);
					return;
				}
				// Confirmed in the owner's own terms rather than echoing the enum:
				// "always" and "never" are commitments, and the point of the echo is
				// that someone who typed the wrong one notices now.
				const said =
					state === "ALWAYS_ALLOW"
						? "will proceed without asking"
						: state === "NEVER"
							? "is refused outright, and files no request"
							: "asks you each time";
				output.success(`${procedurePath} ${said}.`);
			} catch (error: unknown) {
				handleError(output, error, "set the permission");
			}
		});
}

function bypassCommand(): Command {
	return new Command("bypass")
		.description("Stop this agent asking about read-only operations")
		.argument("<agentId>", "Agent to change", requireNonEmptyArg("Agent ID"))
		.argument("<state>", "on or off", validateToggle)
		.action(async function (this: Command, agentId: string, on: boolean) {
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);

			try {
				const client = await requireAuth(globals);
				const result = await client.post<PermissionList>(base(agentId), {
					agentId,
					bypassReads: on,
				});

				if (output.isMachineFormat()) {
					output.json(result);
					return;
				}
				output.success(
					on
						? "Bypass on — this agent will not ask about read-only operations."
						: "Bypass off — read-only operations ask again.",
				);
			} catch (error: unknown) {
				handleError(output, error, "set the read bypass");
			}
		});
}

export function permissionsCommands(): Command {
	return new Command("permissions")
		.description("What an agent may do without asking you (owner-only)")
		.addCommand(listCommand())
		.addCommand(setCommand())
		.addCommand(bypassCommand());
}
