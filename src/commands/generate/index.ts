/**
 * `am generate <kind>` — scaffold starter code for common Anima patterns.
 *
 * Why this exists:
 *   The doc calls out "lowers time-to-first-webhook" as the goal. A user
 *   who needs an inbound-email handler shouldn't have to read 800 words
 *   of docs and copy-paste between tabs to get a working endpoint. They
 *   should be able to type `am generate webhook-handler` and get a
 *   complete, runnable file with the right signature, error handling,
 *   and a comment explaining what the next 3 steps are.
 *
 * Three kinds today (small, focused — easy to extend later):
 *
 *   1. agent          — TypeScript starter for a multi-channel agent that
 *                       reacts to inbound email + voice with the SDK.
 *   2. webhook-handler — Bun/Node HTTP server that verifies Anima webhook
 *                        signatures and dispatches by event type.
 *   3. mcp-config     — minimal MCP server config for Claude Desktop /
 *                        Cursor / Windsurf with the Anima MCP URL.
 *
 * Output: writes one file to <output> (default: cwd) and prints what to
 * do next. Refuses to overwrite by default; pass --force to skip the
 * existence check.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Command } from "commander";
import type { GlobalOptions } from "../../lib/auth.js";
import { Output } from "../../lib/output.js";

interface GenerateOptions {
	output?: string;
	force?: boolean;
}

const SCAFFOLDS = {
	agent: {
		filename: "anima-agent.ts",
		content: `/**
 * Anima starter agent.
 *
 * Reacts to inbound email and routes urgent ones to a voice callback.
 * Replace the YOUR_* values with your own and run:
 *
 *   bun run anima-agent.ts
 *
 * See https://docs.useanima.sh/quickstart for the long-form walkthrough.
 */

import { Anima } from '@anima/sdk';

const am = new Anima({ apiKey: process.env.ANIMA_API_KEY! });

// Subscribe to inbound email for this agent. Each event carries a
// correlation ID server-generated for the inbound message; pass it
// through to outbound actions to thread the workflow.
am.on('email.received', async (msg) => {
  console.log(\`[\${msg.correlationId}] inbound from \${msg.from.email}: "\${msg.subject}"\`);

  // Heuristic: subject contains "urgent" → call them back.
  if (msg.subject.toLowerCase().includes('urgent') && msg.from.phone) {
    const call = await am.voice.placeCall({
      identityId: msg.identityId,
      correlationId: msg.correlationId,
      to: msg.from.phone,
      consentSource: 'customer-initiated', // they emailed us first
      greeting: \`Hi, this is the support team calling about your email "\${msg.subject}".\`,
    });
    console.log(\`[\${msg.correlationId}] placed voice call \${call.callId}\`);
    return;
  }

  // Default: send a polite reply.
  await am.email.send({
    identityId: msg.identityId,
    correlationId: msg.correlationId,
    threadId: msg.threadId,
    to: msg.from.email,
    subject: \`Re: \${msg.subject}\`,
    html: '<p>Got it — a human will follow up within one business day.</p>',
  });
});

console.log('Agent listening. Send an email to your agent inbox to test.');
`,
	},
	"webhook-handler": {
		filename: "anima-webhook.ts",
		content: `/**
 * Anima webhook handler.
 *
 * Bun HTTP server that verifies Anima signatures and dispatches by
 * event type. Run with:
 *
 *   ANIMA_WEBHOOK_SECRET=whsec_... bun run anima-webhook.ts
 *
 * Then register the URL in your Anima dashboard under Webhooks.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.ANIMA_WEBHOOK_SECRET ?? '';
if (!SECRET.startsWith('whsec_')) {
  console.error('Set ANIMA_WEBHOOK_SECRET=whsec_... before starting.');
  process.exit(1);
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', SECRET).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(\`sha256=\${expected}\`);
  const actualBuf = Buffer.from(signature);
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

interface AnimaEvent {
  id: string;
  type: string;
  correlationId: string;
  data: Record<string, unknown>;
}

async function handleEvent(event: AnimaEvent): Promise<void> {
  switch (event.type) {
    case 'email.received':
      console.log(\`[\${event.correlationId}] email received\`, event.data);
      break;
    case 'voice.call.completed':
      console.log(\`[\${event.correlationId}] voice call completed\`, event.data);
      break;
    case 'vault.credential.read':
      console.log(\`[\${event.correlationId}] vault credential read\`, event.data);
      break;
    default:
      console.log(\`[\${event.correlationId}] unhandled event \${event.type}\`);
  }
}

Bun.serve({
  port: 3000,
  async fetch(req) {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const rawBody = await req.text();
    const signature = req.headers.get('x-anima-signature');

    if (!verifySignature(rawBody, signature)) {
      return new Response('Invalid signature', { status: 401 });
    }

    const event = JSON.parse(rawBody) as AnimaEvent;
    await handleEvent(event);
    return new Response('ok', { status: 200 });
  },
});

console.log('Webhook handler listening on :3000');
`,
	},
	"mcp-config": {
		filename: "mcp-config.json",
		content: `{
  "_": "Anima MCP server config. Drop into your IDE's MCP settings file:",
  "_claude_desktop": "  ~/Library/Application Support/Claude/claude_desktop_config.json (mac)",
  "_cursor":         "  Cursor → Settings → MCP → Add server",
  "_windsurf":       "  ~/.codeium/windsurf/mcp_config.json",
  "_vscode":         "  Settings → Extensions → MCP",
  "_alternatively":  "Or run: am setup-mcp install — does all of the above for you.",

  "mcpServers": {
    "anima": {
      "url": "https://mcp.useanima.sh/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ANIMA_API_KEY"
      }
    }
  }
}
`,
	},
} as const;

type ScaffoldKind = keyof typeof SCAFFOLDS;
const VALID_KINDS = Object.keys(SCAFFOLDS) as ScaffoldKind[];

export function generateCommand(): Command {
	return new Command("generate")
		.alias("gen")
		.description(`Scaffold starter code (${VALID_KINDS.join(" | ")})`)
		.argument("<kind>", `What to generate: ${VALID_KINDS.join(", ")}`)
		.option("-o, --output <path>", "Directory to write into (default: cwd)")
		.option("-f, --force", "Overwrite if the file already exists", false)
		.action(async function (this: Command, kindArg: string) {
			const opts = this.opts<GenerateOptions>();
			const globals = this.optsWithGlobals<GenerateOptions & GlobalOptions>();
			const output = new Output({
				json: globals.json ?? false,
				debug: globals.debug ?? false,
			});

			const kind = kindArg as ScaffoldKind;
			if (!VALID_KINDS.includes(kind)) {
				output.error(
					`Unknown kind "${kindArg}". Use one of: ${VALID_KINDS.join(", ")}.`,
				);
				process.exit(2);
			}

			const scaffold = SCAFFOLDS[kind];
			const dir = resolve(opts.output ?? process.cwd());
			const target = join(dir, scaffold.filename);

			if (existsSync(target) && !opts.force) {
				output.error(`${target} already exists. Pass --force to overwrite.`);
				process.exit(1);
			}

			writeFileSync(target, scaffold.content, "utf-8");

			output.success(`Wrote ${target}`);
			output.info(nextSteps(kind));
		});
}

function nextSteps(kind: ScaffoldKind): string {
	switch (kind) {
		case "agent":
			return "Next: set ANIMA_API_KEY in your env, then `bun run anima-agent.ts`. Send an email to your agent inbox to trigger the handler.";
		case "webhook-handler":
			return "Next: set ANIMA_WEBHOOK_SECRET, run `bun run anima-webhook.ts`, then register the URL under Webhooks in your dashboard.";
		case "mcp-config":
			return "Next: replace YOUR_ANIMA_API_KEY with an `ak_` from `am auth whoami` and drop this into your IDE config (paths inside the file).";
	}
}
