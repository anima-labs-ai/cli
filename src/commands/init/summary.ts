/**
 * What `am init` tells you once the agent exists.
 *
 * Split out of index.ts because it is pure presentation — every decision has
 * already been made by the time these run, and none of them touch the network
 * or config. Keeping it inline pushed both `runInteractiveNew` past 300 lines
 * and the file past 1000.
 *
 * The ordering is deliberate and numbered in the notes themselves: verify
 * first (nothing else works unverified), then the vault, then what to try.
 */

import * as clack from "@clack/prompts";

export interface NewAgentSummary {
	inboxId: string;
	agentId: string;
	organizationId: string;
	apiKey: string;
	configDir: string;
	/** Set once sign-up provisioned one; null when it did not. */
	vaultId?: string | null;
	phoneNumber: string | null;
	phoneError: string | null;
	/** Profile name a displaced previous setup was parked under, if any. */
	archived: string | null;
}

/** The block of ids and paths — what the user needs to find things again. */
export function printAgentSummary(s: NewAgentSummary): void {
	const lines = [
		`Inbox:    ${s.inboxId}`,
		`Agent ID: ${s.agentId}`,
		`Org ID:   ${s.organizationId}`,
		// Read the path rather than name it: config lives wherever env-paths puts
		// it (~/Library/Preferences/anima on macOS, $XDG_CONFIG_HOME/anima on
		// Linux), never in the `~/.anima/config` this line used to claim. That
		// directory does not exist, so anyone who went looking for their key
		// after init found nothing there.
		`API key:  ${s.apiKey.slice(0, 12)}…  (saved to ${s.configDir})`,
	];
	if (s.phoneNumber) lines.push(`Phone:    ${s.phoneNumber}`);
	if (s.vaultId) lines.push(`Vault:    ${s.vaultId}`);
	if (s.archived) {
		lines.push("");
		lines.push(
			"Your previous agent was not deleted — it is saved as a profile.",
		);
		lines.push(`Switch back with:  am config profile use ${s.archived}`);
	}
	if (s.phoneError) {
		lines.push("");
		lines.push(`Phone:    not provisioned (${s.phoneError})`);
		lines.push(
			"         If you are on Free tier, upgrade at https://console.useanima.sh/settings.",
		);
	}
	clack.note(lines.join("\n"), "Your new agent");
}

/**
 * Verification is the next REQUIRED step: until the owner submits the OTP the
 * agent is `agent_unverified` and may only email its own owner. `am verify`
 * exists for exactly this — the OTP used to be sent with no command to submit
 * it, which made onboarding a dead end.
 */
export function printVerifyStep(humanEmail: string): void {
	clack.note(
		[
			`We emailed a 6-digit code to ${humanEmail} (the agent's owner).`,
			`Until it's verified this agent can only email its owner. To unlock`,
			`full sending, get the code from the owner and run:`,
			``,
			`  am verify <code>`,
		].join("\n"),
		"1. Verify to unlock sending",
	);
}

/**
 * What the user can do about secrets, given what actually happened.
 *
 * This note used to say the vault "unlocks on Starter+", which stopped being
 * true with the 2026-07 plan change — Free includes a vault; it is telephony
 * that starts at Starter. Worse, it was the only thing init said about the
 * vault, so the honest version of the old message would have been "you can
 * never have one": sign-up could not provision a vault at all until
 * `provision_vault` existed.
 *
 * Three outcomes, because all three happen: got one, asked and did not get one
 * (the API has the vault feature off), never asked.
 */
export function printVaultStep(
	vaultId: string | null | undefined,
	wanted: boolean,
): void {
	if (vaultId) {
		clack.note(
			[
				`An encrypted vault is ready. Secrets go in by reference — the agent`,
				`uses them without ever reading them back:`,
				``,
				`  am vault store --name stripe-key --type api_key \\`,
				`      --provider stripe --key-stdin --allowed-host api.stripe.com`,
				`  am vault list`,
			].join("\n"),
			"2. Your vault",
		);
		return;
	}
	if (wanted) {
		// Asked for, not delivered. Say so rather than leaving the user to
		// discover it at the first `am vault list`.
		clack.note(
			[
				`A vault was requested but the API did not provision one — the vault`,
				`feature may be disabled on this deployment. Everything else is set up.`,
				``,
				`Ask your owner to approve one:  am request vault --reason "…"`,
			].join("\n"),
			"2. Vault not provisioned",
		);
		return;
	}
	clack.note(
		[
			`No vault was created. An agent cannot provision its own vault after`,
			`sign-up — the owner has to approve it:`,
			``,
			`  am request vault --reason "why you need it"`,
			``,
			`Phone numbers and extra capacity start on Starter+.`,
		].join("\n"),
		"2. More capabilities",
	);
}

/**
 * Closing suggestions — and ONLY commands the key init just saved can run.
 *
 * `am tail` used to be here and cannot work: /v1/events/stream is master-gated
 * and init stores an agent key, so the second thing onboarding suggested
 * answered 403. A syntax guard (see onboard-advertised.test.ts) would not have
 * caught that — the command exists, the credential just cannot use it — so the
 * rule for this list is narrower than "is it real syntax": it has to work with
 * what init just saved.
 */
export function printOutro(): void {
	clack.outro(
		[
			"Welcome aboard. ✸  Try:",
			'  am email send --to friend@example.com --subject "Hi" --body "I am alive"',
			"  am agent list             (every agent in your org)",
			"  am auth whoami            (which agent you are acting as)",
			"  Dashboard: https://console.useanima.sh",
		].join("\n"),
	);
}
