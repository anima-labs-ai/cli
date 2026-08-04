/**
 * `am init` — magical first-run with @clack/prompts.
 *
 * Two modes:
 *
 *   1. Interactive (default): the wedge demo. Provisions a fresh agent
 *      identity (org + agent + email inbox + API key) in one flow, then
 *      optionally a phone number, then optionally MCP setup. All saved to
 *      `~/.anima/config.json`. Goal: working agent identity in <60 seconds
 *      from `npx @anima-labs/cli init`.
 *
 *   2. Non-interactive (--non-interactive): the legacy "configure with
 *      existing key" path. Used by CI scripts and existing customers
 *      pointing the CLI at an already-provisioned org.
 *
 * The interactive flow:
 *   - Step 1: ask "new" or "existing key"
 *   - Step 2 (new):
 *       a. human email (where the OTP lands)
 *       b. agent username (becomes <slug>@agents.useanima.sh)
 *       c. POST /v1/agent/sign-up → master key + agent + inbox + ak_ key
 *       d. confirm phone provisioning (Starter+ tier required, prompt for
 *          tier upgrade later if Free)
 *       e. confirm MCP setup → run `am setup-mcp install` if yes
 *       f. summary: inbox, phone (if any), dashboard link, next-step CLI
 *          commands
 *   - Step 2 (existing): API URL + API key + default org/identity + output
 *     format. Same shape as the old interactive flow but rendered via
 *     clack so it matches the new UX.
 *
 * Cancel handling: clack returns a Symbol on cancel; we exit cleanly with
 * a "see you later" rather than a stack trace.
 */

import * as clack from "@clack/prompts";
import { Command } from "commander";
import { requireNonEmptyArg } from "../../lib/args.js";
import type { GlobalOptions } from "../../lib/auth.js";
import {
	getAuthConfig,
	getConfig,
	getConfigDir,
	saveAuthConfig,
	saveConfig,
} from "../../lib/config.js";
import { enrollmentFor } from "../../lib/elevation.js";
import { handleOrpcError, requireOrpcAuth } from "../../lib/orpc.js";
import { Output } from "../../lib/output.js";
import {
	printAgentSummary,
	printOutro,
	printVaultStep,
	printVerifyStep,
} from "./summary.js";

const DEFAULT_API_URL = "https://api.useanima.sh";
const DEFAULT_OUTPUT_FORMAT = "table";

type OutputFormat = "table" | "json" | "yaml";

interface InitOptions {
	nonInteractive?: boolean;
	apiKey?: string;
	apiUrl?: string;
	org?: string;
	identity?: string;
	format?: string;
}

interface SignUpResponse {
	agent_id: string;
	organization_id: string;
	inbox_id: string;
	api_key: string;
	master_key?: string;
	auth_type: "agent_unverified" | "agent_verified" | "claimed";
	/**
	 * Set when sign-up was asked to provision a vault and did. Optional because
	 * an older API returns no such field; `null` because a current API that has
	 * the vault feature switched off returns one explicitly.
	 */
	vault_id?: string | null;
}

function normalizeOutputFormat(format?: string): OutputFormat | null {
	const normalized = format?.trim().toLowerCase() ?? DEFAULT_OUTPUT_FORMAT;
	if (normalized === "table") return "table";
	if (normalized === "json") return "json";
	if (normalized === "yaml") return "yaml";
	return null;
}

function isValidApiKey(apiKey: string): boolean {
	return (
		apiKey.startsWith("ak_") ||
		apiKey.startsWith("mk_") ||
		apiKey.startsWith("sk_")
	);
}

function isCancel<T>(value: T | symbol): value is symbol {
	return clack.isCancel(value);
}

function bail(): never {
	clack.cancel("Cancelled. Run `am init` again whenever you are ready.");
	process.exit(0);
}

/**
 * A failed sign-up, carrying the HTTP status.
 *
 * The status is what tells the two failures apart, and they want opposite
 * advice: 409 means an org already exists for this *email* and no retry of any
 * kind will work, while a 4xx on the username genuinely does want a different
 * username. Flattening both into a message string is how the caller ended up
 * offering one piece of guidance for both.
 */
class SignUpError extends Error {
	constructor(
		readonly status: number,
		readonly body: string,
	) {
		super(`HTTP ${status}: ${body.slice(0, 200)}`);
		this.name = "SignUpError";
	}
}

async function callSignUp(
	apiUrl: string,
	humanEmail: string,
	username: string,
	provisionVault: boolean,
): Promise<SignUpResponse> {
	const response = await fetch(`${apiUrl}/v1/agent/sign-up`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			human_email: humanEmail,
			username,
			provision_vault: provisionVault,
		}),
	});
	if (!response.ok) {
		throw new SignUpError(response.status, await response.text());
	}
	return (await response.json()) as SignUpResponse;
}

async function tryProvisionPhone(
	apiUrl: string,
	apiKey: string,
	agentId: string,
	countryCode: string,
	areaCode: string | null,
): Promise<{ phoneNumber: string } | { error: string }> {
	const body: Record<string, unknown> = { agentId, countryCode };
	if (areaCode) body.areaCode = areaCode;
	const response = await fetch(`${apiUrl}/phone/provision`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		const text = await response.text();
		return { error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
	}
	const data = (await response.json()) as { phoneNumber: string };
	return { phoneNumber: data.phoneNumber };
}

/**
 * Is there already a working setup on this machine?
 *
 * Exported, with [[archiveCurrentSetup]], because the wizard around them is
 * built on clack prompts that init.test.ts documents as unmockable — so the
 * only way these two get tested at all is directly. They are the parts worth
 * testing: everything else in the branch is prompt wiring, while these decide
 * whether a user's existing credentials survive a second `am init`.
 */
export async function currentSetup(): Promise<{
	apiKey?: string;
	apiUrl?: string;
	email?: string;
	defaultOrg?: string;
	defaultIdentity?: string;
} | null> {
	const auth = await getAuthConfig();
	const config = await getConfig();
	const configured =
		auth.apiKey !== undefined ||
		config.defaultIdentity !== undefined ||
		config.defaultOrg !== undefined;
	if (!configured) return null;
	return {
		apiKey: auth.apiKey,
		apiUrl: auth.apiUrl,
		email: auth.email,
		defaultOrg: config.defaultOrg,
		defaultIdentity: config.defaultIdentity,
	};
}

/**
 * Copy the active credentials into a named profile before init overwrites
 * them, and return the name it used (or null when there was nothing to keep).
 *
 * `saveConfig` puts a profile's apiKey in the OS keychain and leaves only
 * metadata in config.json, so this archives the key without ever writing it
 * to disk in the clear.
 */
export async function archiveCurrentSetup(): Promise<string | null> {
	const existing = await currentSetup();
	if (!existing) return null;

	const config = await getConfig();
	// Name it after the agent it belongs to — the id is what `am config set
	// defaultIdentity` and every `--agent` flag take, so the profile name is
	// also the answer to "how do I get back to it".
	const base = existing.defaultIdentity ?? existing.defaultOrg ?? "previous";
	let name = base;
	for (let n = 2; config.profiles?.[name] !== undefined; n++)
		name = `${base}-${n}`;

	await saveConfig({
		...config,
		profiles: {
			...config.profiles,
			[name]: {
				apiUrl: existing.apiUrl,
				apiKey: existing.apiKey,
				defaultOrg: existing.defaultOrg,
				defaultIdentity: existing.defaultIdentity,
				outputFormat: config.outputFormat,
			},
		},
	});

	return name;
}

async function runInteractiveNew(
	globals: GlobalOptions,
	output: Output,
): Promise<void> {
	clack.intro("🪐 Welcome to Anima");

	const apiUrl = globals.apiUrl?.trim() || DEFAULT_API_URL;

	const humanEmail = await clack.text({
		message:
			"Agent owner's email (the human who owns this agent — they'll receive the verification code):",
		placeholder: "owner@example.com",
		validate: (value) => {
			if (!value || !value.includes("@")) return "Enter a valid email address.";
		},
	});
	if (isCancel(humanEmail)) bail();

	const username = await clack.text({
		message:
			"Pick a username for your agent (becomes <username>@agents.useanima.sh):",
		placeholder: "shopping-agent",
		validate: (value) => {
			if (!value) return "Username is required.";
			if (!/^[a-z0-9-]+$/.test(value)) {
				return "Lowercase letters, digits, and hyphens only (no spaces or symbols).";
			}
		},
	});
	if (isCancel(username)) bail();

	// Default yes: the vault is free, provisioning it is one row, and it is the
	// only moment this agent can ever get one on its own — `vault provision` is
	// master-gated and sign-up never discloses the master key. Saying no here
	// means asking the owner to approve one later (`am request vault`).
	const provisionVault = await clack.confirm({
		message:
			"Create an encrypted vault for this agent? (Free tier includes one.)",
		initialValue: true,
	});
	if (isCancel(provisionVault)) bail();

	const provisionPhone = await clack.confirm({
		message:
			"Provision a US phone number too? (Starter+ tier required for actual provisioning.)",
		initialValue: false,
	});
	if (isCancel(provisionPhone)) bail();

	let areaCode: string | null = null;
	if (provisionPhone) {
		const ac = await clack.text({
			message: "Preferred area code (or leave blank for any):",
			placeholder: "415",
			validate: (value) => {
				if (value && !/^\d{3}$/.test(value)) return "3 digits, or leave blank.";
			},
		});
		if (isCancel(ac)) bail();
		areaCode = (ac as string).trim() || null;
	}

	const wantMcp = await clack.confirm({
		message: "Set up MCP for Claude Desktop / Cursor / Windsurf / VS Code?",
		initialValue: true,
	});
	if (isCancel(wantMcp)) bail();

	// ── Provision the agent ──
	const signupSpinner = clack.spinner();
	signupSpinner.start("Creating org + agent + inbox…");
	let signup: SignUpResponse;
	try {
		signup = await callSignUp(
			apiUrl,
			humanEmail as string,
			username as string,
			provisionVault as boolean,
		);
		signupSpinner.stop(`Inbox created: ${signup.inbox_id}`);
	} catch (error) {
		signupSpinner.stop("Sign-up failed.");

		// A 409 is not a retryable mistake: sign-up looks the org up by
		// `human_email`, so it is refusing *this human*, not this username.
		// The old advice here — "the username may be taken (try a variation)" —
		// was offered for every failure alike, and following it on a 409 loops
		// forever, because no username makes an existing org sign up again.
		if (error instanceof SignUpError && error.status === 409) {
			output.error(
				`An Anima organization already exists for ${humanEmail as string}.`,
			);
			clack.note(
				[
					"Sign-up cannot hand out credentials for an org that already",
					"exists — that is what stops anyone who knows your email from",
					"claiming your agent.",
					"",
					"  Already have your API key?   am init  →  “existing API key”",
					"  Lost it?                     https://console.useanima.sh",
					"  Wanted a second agent?       am agent create --name … --slug …",
					"",
					"Signing up again needs a different owner email, which creates a",
					"separate organization.",
				].join("\n"),
				"This email is already registered",
			);
			process.exit(1);
		}

		output.error(error instanceof Error ? error.message : String(error));
		output.notice(
			"Common causes: the username may be taken (try a variation), or the Anima API URL may be unreachable.",
		);
		process.exit(1);
	}

	// ── Save creds locally ──
	//
	// Signing up again (necessarily with a different owner email, since the
	// same one is refused) used to overwrite apiKey, defaultOrg and
	// defaultIdentity in place. The previous agent kept working server-side but
	// became unreachable from this machine — its key was simply gone, with
	// nothing recording that it had ever been here. Park it in a named profile
	// first, which is what profiles are for and which keeps the key in the OS
	// keychain rather than config.json.
	const archived = await archiveCurrentSetup();

	await saveAuthConfig({
		...(await getAuthConfig()),
		apiKey: signup.api_key,
		apiUrl,
		email: humanEmail as string,
	});
	const priorConfig = await getConfig();
	const outputFormat = priorConfig.outputFormat ?? "table";

	// Also write the new credentials as a named profile, keyed by org.
	//
	// The flat top-level config holds exactly one setup, so onboarding a
	// second org could only overwrite the first — which is what
	// `archiveCurrentSetup` above exists to soften. Writing a profile at the
	// same time makes that symmetric: every org the machine has ever been set
	// up for is addressable by name from the moment it is created, not only
	// once a later init displaces it. `saveConfig` puts the key in the OS
	// keychain, so this stores no secret in config.json.
	const profileName = signup.organization_id;
	await saveConfig({
		...priorConfig,
		defaultOrg: signup.organization_id,
		defaultIdentity: signup.agent_id,
		// Only seed a format when there isn't one. This used to reset to
		// "table" unconditionally, quietly undoing `am config set outputFormat`
		// for anyone who re-ran init.
		outputFormat,
		profiles: {
			...priorConfig.profiles,
			[profileName]: {
				apiUrl,
				apiKey: signup.api_key,
				defaultOrg: signup.organization_id,
				defaultIdentity: signup.agent_id,
				outputFormat,
			},
		},
	});

	// ── Provision phone (optional) ──
	let phoneNumber: string | null = null;
	let phoneError: string | null = null;
	if (provisionPhone) {
		const phoneSpinner = clack.spinner();
		phoneSpinner.start("Provisioning phone number…");
		const phoneResult = await tryProvisionPhone(
			apiUrl,
			signup.api_key,
			signup.agent_id,
			"US",
			areaCode,
		);
		if ("error" in phoneResult) {
			phoneError = phoneResult.error;
			phoneSpinner.stop("Phone provisioning skipped.");
		} else {
			phoneNumber = phoneResult.phoneNumber;
			phoneSpinner.stop(`Phone provisioned: ${phoneNumber}`);
		}
	}

	// ── MCP setup (optional) ──
	if (wantMcp) {
		clack.note(
			"Run `am setup-mcp install` after this wizard finishes to register Anima with your IDE.",
			"MCP setup",
		);
	}

	// ── Summary + next steps ──
	// All presentation, so it lives in ./summary.ts; every decision above it
	// has already been made by this point.
	printAgentSummary({
		inboxId: signup.inbox_id,
		agentId: signup.agent_id,
		organizationId: signup.organization_id,
		apiKey: signup.api_key,
		configDir: getConfigDir(),
		vaultId: signup.vault_id,
		phoneNumber,
		phoneError,
		archived,
	});
	printVerifyStep(humanEmail as string);
	printVaultStep(signup.vault_id, provisionVault as boolean);
	printOutro();
}

async function runInteractiveExisting(
	globals: GlobalOptions,
	output: Output,
): Promise<void> {
	clack.intro("Configure Anima CLI with an existing API key");

	const apiUrl = await clack.text({
		message: "API URL:",
		placeholder: DEFAULT_API_URL,
		initialValue: globals.apiUrl?.trim() || DEFAULT_API_URL,
	});
	if (isCancel(apiUrl)) bail();

	const apiKey = await clack.password({
		message: "API key (ak_… or mk_…):",
		validate: (value) => {
			if (!value) return "API key is required.";
			if (!isValidApiKey(value)) return "Must start with ak_, mk_, or sk_.";
		},
	});
	if (isCancel(apiKey)) bail();

	const org = await clack.text({
		message: "Default organization (optional):",
		placeholder: "leave blank to skip",
	});
	if (isCancel(org)) bail();

	const identity = await clack.text({
		message: "Default identity (optional):",
		placeholder: "leave blank to skip",
	});
	if (isCancel(identity)) bail();

	const format = await clack.select({
		message: "Output format:",
		initialValue: "table" as OutputFormat,
		options: [
			{ value: "table", label: "table — human-readable" },
			{ value: "json", label: "json — script-friendly" },
			{ value: "yaml", label: "yaml — also script-friendly" },
		],
	});
	if (isCancel(format)) bail();

	const wantMcp = await clack.confirm({
		message: "Set up MCP for Claude Desktop / Cursor / Windsurf / VS Code?",
		initialValue: false,
	});
	if (isCancel(wantMcp)) bail();

	await saveAuthConfig({
		...(await getAuthConfig()),
		apiKey: apiKey as string,
		apiUrl: apiUrl as string,
	});
	await saveConfig({
		...(await getConfig()),
		defaultOrg: ((org as string) || "").trim() || undefined,
		defaultIdentity: ((identity as string) || "").trim() || undefined,
		outputFormat: format as OutputFormat,
	});

	const lines = [
		`API URL:  ${apiUrl}`,
		`API key:  configured (${(apiKey as string).slice(0, 12)}…)`,
		`Org:      ${((org as string) || "").trim() || "—"}`,
		`Identity: ${((identity as string) || "").trim() || "—"}`,
		`Format:   ${format}`,
	];
	clack.note(lines.join("\n"), "Configured");

	if (wantMcp) {
		clack.note(
			"Run `am setup-mcp install` after this wizard finishes.",
			"MCP setup",
		);
	}

	clack.outro("✓ CLI configured. Try `am whoami` to verify.");
	void output;
}

async function runNonInteractive(
	opts: InitOptions,
	output: Output,
): Promise<void> {
	const apiKey = opts.apiKey?.trim() ?? "";
	if (!apiKey) {
		output.fatal("Missing required flag --api-key in non-interactive mode.", 2);
	}
	if (!isValidApiKey(apiKey)) {
		output.fatal("Invalid API key. Must start with ak_, mk_, or sk_.", 2);
	}

	const apiUrl = opts.apiUrl?.trim() || DEFAULT_API_URL;
	const org = opts.org?.trim() || undefined;
	const identity = opts.identity?.trim() || undefined;
	const parsedFormat = normalizeOutputFormat(opts.format);
	if (!parsedFormat) {
		output.fatal("Invalid format. Supported values: table, json, yaml.", 2);
	}

	await saveAuthConfig({
		...(await getAuthConfig()),
		apiKey,
		apiUrl,
	});
	await saveConfig({
		...(await getConfig()),
		defaultOrg: org,
		defaultIdentity: identity,
		outputFormat: parsedFormat,
	});

	// Machine formats expect a single structured document on stdout, no
	// spinners or human-readable details. Through `output.json` so the shape
	// follows --format; it used to hand-roll pretty JSON and therefore
	// answered `--format yaml` with JSON.
	if (output.isMachineFormat()) {
		output.json({
			apiUrl,
			apiKeyConfigured: true,
			defaultOrg: org,
			defaultIdentity: identity,
			outputFormat: parsedFormat,
		});
		return;
	}

	output.success("Anima CLI configured (non-interactive).");
	output.details([
		["API URL", apiUrl],
		["API Key", "Configured"],
		["Default Organization", org],
		["Default Identity", identity],
		["Output Format", parsedFormat],
	]);
}

/**
 * Can the stored credential create an agent?
 *
 * Creating an agent needs master capability, and the key `init` stores cannot
 * have it: sign-up mints both an `mk_` and an `ak_` for the new org but only
 * ever returns the `ak_`. So the machine most likely to be asking for a second
 * agent is precisely the one that cannot make one, and offering it the attempt
 * costs two prompts before a server error explains why.
 *
 * `oat_` is OAuth, where the answer depends on whether `admin:full` was
 * granted — and the granted scopes are not persisted locally (AuthConfig has
 * no `scope` field), so the honest answer is "unknown" and the only way to
 * find out is to try.
 */
export function masterCapability(
	apiKey: string | undefined,
): "yes" | "no" | "unknown" {
	if (apiKey === undefined) return "unknown";
	if (apiKey.startsWith("mk_")) return "yes";
	if (apiKey.startsWith("ak_")) return "no";
	return "unknown";
}

/**
 * Can this machine actually provision an agent?
 *
 * `masterCapability` answers a narrower question — what the stored key's prefix
 * implies — and is not sufficient on its own any more. An enrolled machine
 * holding an `ak_` key can provision: `requireOrpcAuth` steps up on
 * MASTER_KEY_REQUIRED and retries. Two callers need this answer, and before this
 * existed they disagreed: the create path had been taught about enrolment while
 * the menu that offers it had not, so an enrolled machine was told it "needs a
 * master key (mk_…)" and steered away from the option that would have worked.
 * One predicate, so the offer and the attempt cannot contradict each other.
 */
async function canProvisionAgents(orgId: string | undefined): Promise<boolean> {
	const auth = await getAuthConfig();
	if (masterCapability(auth.apiKey) !== "no") return true;
	return orgId !== undefined && (await enrollmentFor(orgId)) !== undefined;
}

/** What to do about it — the same advice from the two places that need it. */
function masterKeyGuidance(): string {
	return [
		"Creating an agent needs master credentials. The key `am init` saves is",
		"an agent key (ak_…), which can send and read as its own agent but",
		"cannot provision new ones.",
		"",
		"Quickest route — a code goes to the org owner's email, and you get",
		"15 minutes of admin access:",
		"",
		"  am auth elevate",
		"",
		"Or, if you already have a master key:",
		"  1. Open https://console.useanima.sh and copy your master key (mk_…)",
		"  2. am init  →  “Configure with an existing API key”",
		'  3. am agent create --name "…" --slug "…"',
	].join("\n");
}

/**
 * Create another agent inside the org that is already configured.
 *
 * This is the branch the wizard never had. "I already have an org, I just want
 * a second agent" was only reachable by knowing `am identity create --org …`
 * and the org id — so the discoverable path, re-running init, went to sign-up
 * instead and was refused.
 */
async function createAgentInCurrentOrg(
	orgId: string,
	globals: GlobalOptions,
	output: Output,
): Promise<void> {
	// Check before prompting, not after. Asking for a name and a slug and then
	// failing on the request wastes the answers and reports the problem as
	// though the input caused it.
	if (!(await canProvisionAgents(orgId))) {
		clack.note(masterKeyGuidance(), "This needs a master key");
		clack.outro("Nothing changed.");
		return;
	}

	const name = await clack.text({
		message: "Agent name:",
		placeholder: "Shopping Agent",
		validate: (value) => {
			if (!value || value.trim().length < 2) return "At least 2 characters.";
			if (value.length > 100) return "At most 100 characters.";
		},
	});
	if (isCancel(name)) bail();

	const slug = await clack.text({
		message: "Agent slug (becomes <slug>@agents.useanima.sh):",
		placeholder: "shopping-agent",
		validate: (value) => {
			if (!value) return "Slug is required.";
			if (!/^[a-z0-9-]+$/.test(value)) {
				return "Lowercase letters, digits, and hyphens only.";
			}
			if (value.length < 2 || value.length > 64) return "2-64 characters.";
		},
	});
	if (isCancel(slug)) bail();

	const spinner = clack.spinner();
	spinner.start("Creating agent…");

	// Everything that needs `agent` stays inside the try. `handleOrpcError` is
	// typed `never`, but TypeScript's definite-assignment analysis does not
	// carry that out of a catch block, so a `let agent` declared above and used
	// below reads as possibly-unassigned.
	try {
		const orpc = await requireOrpcAuth(globals);
		const agent = await orpc.agent.create({
			orgId,
			name: (name as string).trim(),
			slug: slug as string,
			metadata: {},
		});
		spinner.stop(`Agent created: ${agent.id}`);

		const makeDefault = await clack.confirm({
			message: "Make this the default agent for future commands?",
			initialValue: true,
		});
		if (isCancel(makeDefault)) bail();

		if (makeDefault) {
			const config = await getConfig();
			await saveConfig({ ...config, defaultIdentity: agent.id });
		}

		clack.outro(
			makeDefault
				? `Done. Commands now act as ${agent.id} unless you pass --agent.`
				: `Done. Use it with:  --agent ${agent.id}`,
		);
	} catch (error) {
		spinner.stop("Could not create the agent.");

		// The OAuth case reaches here: scopes aren't stored locally, so the
		// server is the first thing that can say the token lacks admin:full.
		// Its message names three ways to get master capability without
		// saying which applies to you, or that `am auth login` will not
		// request that scope — so answer the question the user is actually
		// left with.
		if (error instanceof Error && /master key required/i.test(error.message)) {
			output.error("This credential cannot create agents.");
			clack.note(masterKeyGuidance(), "This needs a master key");
			process.exit(1);
		}

		handleOrpcError(error, output, "Failed to create agent");
	}
}

/**
 * Offer a configured user the things they might actually want, before the
 * wizard assumes they are new. Returns true when the choice was handled here
 * and the caller should stop.
 */
async function offerExistingSetupChoices(
	existing: NonNullable<Awaited<ReturnType<typeof currentSetup>>>,
	globals: GlobalOptions,
	output: Output,
): Promise<boolean> {
	clack.intro("🪐 Anima is already set up on this machine");

	clack.note(
		[
			`Owner:    ${existing.email ?? "—"}`,
			`Agent:    ${existing.defaultIdentity ?? "—"}`,
			`Org:      ${existing.defaultOrg ?? "—"}`,
			`API URL:  ${existing.apiUrl ?? DEFAULT_API_URL}`,
		].join("\n"),
		"Current configuration",
	);

	// Don't recommend what this machine cannot do. An init-provisioned machine
	// holds an `ak_` key, so highlighting that option by default would steer the
	// common case straight into a wall — unless it is enrolled, in which case the
	// step-up covers it and this is the option to recommend.
	const canAddAgent = await canProvisionAgents(existing.defaultOrg);

	const choice = await clack.select({
		message: "What would you like to do?",
		initialValue: (canAddAgent ? "agent" : "existing") as
			| "agent"
			| "org"
			| "existing"
			| "keep",
		options: [
			{
				value: "agent",
				label: canAddAgent
					? "Add another agent to this org (recommended)"
					: "Add another agent to this org",
				hint: canAddAgent
					? "New agent + inbox, same org and billing"
					: "Needs a master key (mk_…) — this machine has an agent key",
			},
			{
				value: "org",
				label: "Start a separate organization",
				hint: "Needs a different owner email; current setup is kept as a profile",
			},
			{
				value: "existing",
				label: "Point this machine at a different API key",
				hint: "Switch to another org you already have credentials for",
			},
			{ value: "keep", label: "Leave everything as it is" },
		],
	});
	if (isCancel(choice)) bail();

	if (choice === "keep") {
		clack.outro("Nothing changed.");
		return true;
	}

	if (choice === "agent") {
		if (!existing.defaultOrg) {
			// Every path that sets defaultIdentity also sets defaultOrg, so this
			// is a hand-edited or half-migrated config rather than a normal state.
			output.error(
				"No default organization is configured, so there is no org to add an agent to.",
			);
			output.notice(
				"Set one with `am org switch <orgId>`, or run `am org list`.",
			);
			process.exit(1);
		}
		await createAgentInCurrentOrg(existing.defaultOrg, globals, output);
		return true;
	}

	if (choice === "existing") {
		await runInteractiveExisting(globals, output);
		return true;
	}

	// "org" falls through to the normal new-account flow, which archives the
	// current credentials into a profile before overwriting them.
	return false;
}

/**
 * The interactive `init` wizard: pick new-agent vs existing-key, then run
 * the matching flow. Exported so `onboard` can launch setup directly when an
 * unauthenticated human runs it, instead of just printing "run anima init".
 */
export async function runInteractiveInit(
	globals: GlobalOptions,
	output: Output,
): Promise<void> {
	// Ask before the wizard, not after it. Re-running init used to walk a
	// configured user through every prompt — email, username, phone, MCP — and
	// only then discover, from a 409 on the final call, that sign-up refuses an
	// email that already has an org. The two things such a user actually wants,
	// another agent in the org they already have or a look at what is
	// configured, were not on offer anywhere in that flow.
	const existing = await currentSetup();
	if (existing) {
		const done = await offerExistingSetupChoices(existing, globals, output);
		if (done) return;
	}

	const mode = await clack.select({
		message: "How would you like to set up?",
		initialValue: "new" as "new" | "existing",
		options: [
			{
				value: "new",
				label: "Create a fresh agent (recommended)",
				hint: "Provisions org + agent + email inbox in one flow",
			},
			{
				value: "existing",
				label: "Configure with an existing API key",
				hint: "For teams with an Anima org already provisioned",
			},
		],
	});
	if (isCancel(mode)) bail();

	if (mode === "new") {
		await runInteractiveNew(globals, output);
	} else {
		await runInteractiveExisting(globals, output);
	}
}

export function initCommand(): Command {
	return new Command("init")
		.description(
			"Set up Anima CLI — provisions a fresh agent (email + phone) in 60 seconds",
		)
		.option("--non-interactive", "Use defaults without prompting (CI mode)")
		.option("--api-key <key>", "API key (required in non-interactive mode)")
		.option("--api-url <url>", "API URL")
		.option("--org <org>", "Default organization")
		.option(
			"--identity <id>",
			"Default identity",
			requireNonEmptyArg("Identity ID"),
		)
		.option("--format <format>", "Output format (table/json/yaml)")
		.action(async function (this: Command) {
			const opts = this.opts<InitOptions>();
			const globals = this.optsWithGlobals<InitOptions & GlobalOptions>();
			const output = new Output({
				json: globals.json ?? false,
				debug: globals.debug ?? false,
			});

			if (opts.nonInteractive) {
				await runNonInteractive(opts, output);
				return;
			}

			await runInteractiveInit(globals, output);
		});
}
