/**
 * Intent test for the commands `anima onboard` tells a new user to run.
 *
 * Onboarding output is the first CLI syntax anyone types, so a stale command
 * here costs more than anywhere else: the user has no prior model to tell
 * "this tool is broken" from "I typed it wrong". `demo` has been guarded this
 * way since the 2026-07-16 audit; `onboard` was not, and drifted the same way.
 *
 * `demo` became a single email walkthrough and dropped its `--only-<flow>`
 * flags. onboard kept advertising `anima demo --only-email`, so following
 * onboarding's own next-step produced "error: unknown option '--only-email'".
 * It also offered `--only-x402`, whose flow had been removed outright.
 *
 * Same walker as demo.test.ts, against the real commander tree.
 */
import { describe, test, expect } from "bun:test";
import { createProgram } from "../../cli.js";
import { ONBOARD_NEXT_STEPS } from "../../commands/onboard/index.js";
import { validateAdvertisedCommand } from "../helpers/advertised-commands.js";

describe("onboard next steps", () => {
	test("every advertised command is real CLI syntax", () => {
		const program = createProgram();

		// Guard the guard: an empty list would satisfy the loop below silently.
		expect(ONBOARD_NEXT_STEPS.length).toBeGreaterThan(0);

		for (const entry of ONBOARD_NEXT_STEPS) {
			const problems = validateAdvertisedCommand(program, entry.command);
			// Name the culprit in the failure rather than just "expected []".
			expect({ command: entry.command, problems }).toEqual({
				command: entry.command,
				problems: [],
			});
		}
	});

	test("the flags onboard used to advertise are correctly rejected", () => {
		const program = createProgram();

		// If `demo` ever regrows these, this test should be deleted along with
		// the guard it protects — not before.
		expect(validateAdvertisedCommand(program, "anima demo --only-email")).not.toEqual([]);
		expect(validateAdvertisedCommand(program, "anima demo --only-x402")).not.toEqual([]);
	});

	test("every step carries a description, so the JSON payload is usable", () => {
		for (const entry of ONBOARD_NEXT_STEPS) {
			expect(entry.description.length).toBeGreaterThan(0);
		}
	});
});
