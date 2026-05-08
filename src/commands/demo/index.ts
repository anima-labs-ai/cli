/**
 * `anima demo` — runnable test-mode demos for each Anima flow.
 *
 * Mirrors `link-cli demo` from Stripe. Always uses `--test` mode end-to-end
 * so no real emails sent, real numbers provisioned, or real x402 settlements
 * happen.
 *
 * Subcommands:
 *   anima demo                   menu — pick a flow
 *   anima demo --only-email      send a test email + read inbox
 *   anima demo --only-x402       sandboxed x402 fetch
 *
 * Output:
 *   - Default agent format: structured `{step, status, data}` payloads per
 *     step so agents reading this for the first time can follow the JSON
 *     contract.
 *   - --human: clack-styled walkthrough with progress markers.
 */

import * as clack from "@clack/prompts";
import { Command } from "commander";
import type { GlobalOptions } from "../../lib/auth.js";
import { Output } from "../../lib/output.js";

interface DemoOptions {
	onlyEmail?: boolean;
	onlyX402?: boolean;
}

type DemoFlow = "email" | "x402";

export function demoCommand(): Command {
	return new Command("demo")
		.description(
			"Runnable test-mode demos. Always --test, no real emails sent.",
		)
		.option("--only-email", "Run the email send demo only", false)
		.option("--only-x402", "Run the x402 sandbox fetch demo only", false)
		.action(async function (this: Command) {
			const opts = this.opts<DemoOptions>();
			const globals = this.optsWithGlobals<GlobalOptions>();
			const output = Output.fromGlobals(globals);
			const isAgent = !globals.human && globals.format !== "human";

			const flow = pickFlow(opts);
			if (!flow && !isAgent) {
				clack.intro("Anima demo");
				const choice = await clack.select({
					message: "Pick a flow:",
					options: [
						{
							value: "email",
							label: "Email — send + receive a test email",
						},
						{
							value: "x402",
							label: "x402 — sandboxed HTTP 402 fetch",
						},
					],
				});
				if (clack.isCancel(choice)) {
					clack.outro("See you later.");
					return;
				}
				await runFlow(choice as DemoFlow, output, isAgent);
				return;
			}

			if (!flow) {
				if (isAgent) {
					output.payload({
						status: "menu",
						available_flows: ["email", "x402"],
						usage: "anima demo --only-<flow>",
					});
					return;
				}
			} else {
				await runFlow(flow, output, isAgent);
			}
		});
}

function pickFlow(opts: DemoOptions): DemoFlow | null {
	if (opts.onlyEmail) return "email";
	if (opts.onlyX402) return "x402";
	return null;
}

async function runFlow(
	flow: DemoFlow,
	output: Output,
	isAgent: boolean,
): Promise<void> {
	switch (flow) {
		case "email":
			await runEmailDemo(output, isAgent);
			return;
		case "x402":
			await runX402Demo(output, isAgent);
			return;
	}
}

// ── Email demo ───────────────────────────────────────────────────────────────

async function runEmailDemo(output: Output, isAgent: boolean): Promise<void> {
	const fake = {
		message_id: "msg_demo_001",
		from: "demo-agent@agents.useanima.sh",
		to: "you@example.com",
		subject: "Hello from Anima",
		text: "This is a test email from a demo agent.",
		test_mode: true,
		status: "delivered",
	};

	if (isAgent) {
		output.payload({
			demo: "email",
			steps: [
				{
					step: 1,
					name: "Send test email",
					command:
						"anima email send --test --to you@example.com --subject 'Hello' --text 'Test message'",
					mock_response: fake,
				},
				{
					step: 2,
					name: "List inbox",
					command: "anima email list --test",
				},
				{
					step: 3,
					name: "Search by query",
					command: "anima email search --test --query 'Hello'",
				},
			],
			docs: "https://docs.useanima.sh/getting-started",
		});
		return;
	}

	clack.intro("Email demo (test mode — no real emails sent)");
	const s = clack.spinner();
	s.start("Sending test email");
	await sleep(400);
	s.stop(`Test email accepted (id: ${fake.message_id})`);
	clack.log.info(`From:     ${fake.from}`);
	clack.log.info(`To:       ${fake.to}`);
	clack.log.info(`Subject:  ${fake.subject}`);
	clack.log.info(`Status:   ${fake.status} (test mode)`);
	clack.note(
		[
			"Real email commands:",
			"  anima email send --to you@x.com --subject Hi --text 'Body'",
			"  anima email list",
			"  anima email search --query keyword",
			"  anima email reply <id> --text 'Reply text'",
		].join("\n"),
		"What just happened",
	);
	clack.outro("Email demo complete.");
}

// ── x402 demo ────────────────────────────────────────────────────────────────

async function runX402Demo(output: Output, isAgent: boolean): Promise<void> {
	const fake = {
		url: "https://sandbox.useanima.sh/x402/echo",
		request: { method: "POST", body: { ping: "pong" } },
		settlement: {
			payment_method: "test_usdc_sandbox",
			amount_cents: 1,
			currency: "USD",
		},
		response: { paid: true, body: { echo: { ping: "pong" }, server_time: Date.now() } },
		test_mode: true,
	};

	if (isAgent) {
		output.payload({
			demo: "x402",
			steps: [
				{
					step: 1,
					name: "Probe URL — receive HTTP 402",
					command: `anima x402 fetch ${fake.url} --sandbox --budget-limit-cents 100`,
				},
				{
					step: 2,
					name: "Settle + retry",
					command: `anima x402 fetch ${fake.url} --sandbox --budget-limit-cents 100 --auto-settle`,
					mock_response: fake.response,
				},
			],
			docs: "https://docs.useanima.sh/protocols",
		});
		return;
	}

	clack.intro("x402 demo (sandbox — no real settlement)");
	const s = clack.spinner();
	s.start("Probing sandbox URL");
	await sleep(400);
	s.message("Got HTTP 402 — building settlement");
	await sleep(400);
	s.stop("Settled, response retrieved");
	clack.log.info(`URL:        ${fake.url}`);
	clack.log.info(`Settled:    ${fake.settlement.amount_cents}¢ (test usdc)`);
	clack.log.info(`Response:   200 OK, body cached`);
	clack.note(
		[
			"Real x402 commands:",
			"  anima x402 fetch <url> --budget-limit-cents 500",
			"  anima x402 fetch <url> --sandbox  (dry-run)",
		].join("\n"),
		"What just happened",
	);
	clack.outro("x402 demo complete.");
}

// ── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
