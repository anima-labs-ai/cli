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
import type { GlobalOptions } from "../../lib/auth.js";
import {
	getAuthConfig,
	getConfig,
	saveAuthConfig,
	saveConfig,
} from "../../lib/config.js";
import { Output } from "../../lib/output.js";

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

async function callSignUp(
	apiUrl: string,
	humanEmail: string,
	username: string,
): Promise<SignUpResponse> {
	const response = await fetch(`${apiUrl}/v1/agent/sign-up`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ human_email: humanEmail, username }),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
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

async function runInteractiveNew(
	globals: GlobalOptions,
	output: Output,
): Promise<void> {
	clack.intro("🪐 Welcome to Anima");

	const apiUrl = globals.apiUrl?.trim() || DEFAULT_API_URL;

	const humanEmail = await clack.text({
		message: "Your email (where Anima will send the agent's verification OTP):",
		placeholder: "you@example.com",
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
		signup = await callSignUp(apiUrl, humanEmail as string, username as string);
		signupSpinner.stop(`Inbox created: ${signup.inbox_id}`);
	} catch (error) {
		signupSpinner.stop("Sign-up failed.");
		output.error(error instanceof Error ? error.message : String(error));
		output.info(
			"Common causes: the username may be taken (try a variation), or the Anima API URL may be unreachable.",
		);
		process.exit(1);
	}

	// ── Save creds locally ──
	await saveAuthConfig({
		...(await getAuthConfig()),
		apiKey: signup.api_key,
		apiUrl,
		email: humanEmail as string,
	});
	await saveConfig({
		...(await getConfig()),
		defaultOrg: signup.organization_id,
		defaultIdentity: signup.agent_id,
		outputFormat: "table",
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

	// ── Summary ──
	const lines = [
		`Inbox:    ${signup.inbox_id}`,
		`Agent ID: ${signup.agent_id}`,
		`Org ID:   ${signup.organization_id}`,
		`API key:  ${signup.api_key.slice(0, 12)}…  (saved to ~/.anima/config)`,
	];
	if (phoneNumber) lines.push(`Phone:    ${phoneNumber}`);
	if (phoneError) {
		lines.push("");
		lines.push(`Phone:    not provisioned (${phoneError})`);
		lines.push(
			"         If you are on Free tier, upgrade at https://console.useanima.sh/settings.",
		);
	}

	clack.note(lines.join("\n"), "Your new agent identity");

	clack.outro(
		`✓ Done. Verify your email at ${humanEmail} (we sent an OTP), then try:\n  am email send --to friend@example.com --subject "Hi" --body "I am alive"\n  am tail   (live event stream)\n  Dashboard: https://console.useanima.sh`,
	);
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
	jsonMode: boolean,
): Promise<void> {
	const apiKey = opts.apiKey?.trim() ?? "";
	if (!apiKey) {
		output.error("Missing required flag --api-key in non-interactive mode.");
		process.exit(2);
	}
	if (!isValidApiKey(apiKey)) {
		output.error("Invalid API key. Must start with ak_, mk_, or sk_.");
		process.exit(2);
	}

	const apiUrl = opts.apiUrl?.trim() || DEFAULT_API_URL;
	const org = opts.org?.trim() || undefined;
	const identity = opts.identity?.trim() || undefined;
	const parsedFormat = normalizeOutputFormat(opts.format);
	if (!parsedFormat) {
		output.error("Invalid format. Supported values: table, json, yaml.");
		process.exit(2);
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

	// JSON mode: scripts piping `am --json init …` expect a single JSON
	// payload on stdout, no spinners or human-readable details. Skip the
	// pretty output entirely and emit one structured object.
	if (jsonMode) {
		console.log(
			JSON.stringify(
				{
					apiUrl,
					apiKeyConfigured: true,
					defaultOrg: org,
					defaultIdentity: identity,
					outputFormat: parsedFormat,
				},
				null,
				2,
			),
		);
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

export function initCommand(): Command {
	return new Command("init")
		.description(
			"Set up Anima CLI — provisions a fresh agent (email + phone) in 60 seconds",
		)
		.option("--non-interactive", "Use defaults without prompting (CI mode)")
		.option("--api-key <key>", "API key (required in non-interactive mode)")
		.option("--api-url <url>", "API URL")
		.option("--org <org>", "Default organization")
		.option("--identity <id>", "Default identity")
		.option("--format <format>", "Output format (table/json/yaml)")
		.action(async function (this: Command) {
			const opts = this.opts<InitOptions>();
			const globals = this.optsWithGlobals<InitOptions & GlobalOptions>();
			const output = new Output({
				json: globals.json ?? false,
				debug: globals.debug ?? false,
			});

			if (opts.nonInteractive) {
				await runNonInteractive(opts, output, globals.json ?? false);
				return;
			}

			const mode = await clack.select({
				message: "How would you like to set up?",
				initialValue: "new" as "new" | "existing",
				options: [
					{
						value: "new",
						label: "Create a fresh agent identity (recommended)",
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
		});
}
