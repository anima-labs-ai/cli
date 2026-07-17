/**
 * `anima demo` — a first-run walkthrough of the email flow.
 *
 * The demo is a local simulation: it makes no API calls and sends
 * nothing. Every command it advertises is real, current CLI syntax —
 * copy-paste any of them (with your own agent id) and they execute.
 *
 * Output:
 *   - Default agent format: structured `{step, name, command}` payloads
 *     so agents reading this for the first time can follow the JSON
 *     contract.
 *   - --human: clack-styled walkthrough with progress markers.
 */

import * as clack from "@clack/prompts";
import { Command } from "commander";
import type { GlobalOptions } from "../../lib/auth.js";
import { Output } from "../../lib/output.js";

export function demoCommand(): Command {
	return new Command("demo")
		.description(
			"First-run email walkthrough. Simulated locally — nothing is sent.",
		)
		.action(async function (this: Command) {
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);
			const isAgent = !globals.human && globals.format !== "human";

			await runEmailDemo(output, isAgent);
		});
}

// ── Email demo ───────────────────────────────────────────────────────────────

/**
 * Every command the demo advertises, in one place. These must be REAL,
 * currently-shipping CLI syntax — `demo.test.ts` walks each one against
 * the actual commander tree and fails the build if a subcommand or flag
 * here does not exist.
 */
export const ADVERTISED_COMMANDS = [
	{
		name: "Send an email",
		command:
			"anima email send --agent <agent-id> --to you@example.com --subject 'Hello' --body 'Test message'",
	},
	{
		name: "List recent emails",
		command: "anima email list --limit 5",
	},
	{
		name: "Fetch one email by id",
		command: "anima email get <email-id>",
	},
	{
		// Restored for real this time: `email search` was advertised as
		// fiction before B11 shipped; it now hits POST /messages/search
		// (add --semantic for embedding-based ranking).
		name: "Search your emails",
		command: "anima email search 'invoice' --semantic",
	},
] as const;

async function runEmailDemo(output: Output, isAgent: boolean): Promise<void> {
	const fake = {
		message_id: "msg_demo_001",
		from: "demo-agent@agents.useanima.sh",
		to: "you@example.com",
		subject: "Hello from Anima",
		body: "This is a simulated email from a demo agent.",
		simulated: true,
		status: "delivered",
	};

	if (isAgent) {
		output.payload({
			demo: "email",
			simulated: true,
			note: "No API calls were made. The commands below are real syntax — run them with your own agent id.",
			steps: ADVERTISED_COMMANDS.map((entry, index) => ({
				step: index + 1,
				name: entry.name,
				command: entry.command,
				...(index === 0 ? { mock_response: fake } : {}),
			})),
			docs: "https://docs.useanima.sh/getting-started",
		});
		return;
	}

	clack.intro("Email demo (simulated — nothing is sent)");
	const s = clack.spinner();
	s.start("Simulating an email send");
	await sleep(400);
	s.stop(`Simulated email accepted (id: ${fake.message_id})`);
	clack.log.info(`From:     ${fake.from}`);
	clack.log.info(`To:       ${fake.to}`);
	clack.log.info(`Subject:  ${fake.subject}`);
	clack.log.info(`Status:   ${fake.status} (simulated)`);
	clack.note(
		[
			"Real email commands:",
			...ADVERTISED_COMMANDS.map((entry) => `  ${entry.command}`),
		].join("\n"),
		"What just happened",
	);
	clack.outro("Email demo complete.");
}

// ── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
