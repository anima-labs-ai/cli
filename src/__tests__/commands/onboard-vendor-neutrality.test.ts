/**
 * Intent test for the vendor names the CLI must never print.
 *
 * Which carrier terminates a call, which vendor transcribes it and which
 * engine stores a secret are sub-processor disclosures. They belong on the
 * subprocessors page and in the DPA, where they are legally required and kept
 * current — not in onboarding copy, where they published our supply chain to
 * every CLI user and quietly pinned us to vendors we are free to swap.
 *
 * The capability matrix broke that rule for its whole life, and broke it
 * twice over: two of the three vendors it named were wrong. It advertised
 * "Telnyx/Deepgram/ElevenLabs" while ElevenLabs was evaluated and rejected
 * (packages/phone voice/providers/aura.ts explains why Aura won), and
 * "Bitwarden-backed" while the vault runs on self-hosted Vaultwarden — which
 * is why Bitwarden is correctly absent from the subprocessor list.
 *
 * The API already holds this line for the voice catalog: voice-crud.test.ts
 * asserts the wire response names no provider or model anywhere, and
 * VoiceSchema carries no provider field at all. This is the same guard for
 * the surface the CLI owns.
 */
import { describe, test, expect } from "bun:test";
import { CAPABILITY_MATRIX } from "../../commands/onboard/index.js";

/**
 * Vendor names that must not appear in the capability matrix.
 *
 * Scope is deliberately that one constant, not "anything the CLI prints". The
 * other surface that leaked a vendor — the Provider column on `phone list` and
 * `phone provision` — is guarded by the type system instead: the field is gone
 * from PhoneIdentityOutput/PhoneProvisionOutput in @anima/contracts, so
 * reprinting it stops compiling once .anima-ref is bumped. Hand-written display
 * copy has no such backstop, which is why it gets a test.
 *
 * Mirrors the denylist the API already applies to the voice catalog
 * (apps/api voice-crud.test.ts), plus the storage and postal vendors the CLI
 * had named on its own.
 *
 * Three calls worth stating, because each one is a way this bug already shipped:
 *
 *   - Vendors we REJECTED are on the list. ElevenLabs was never wired; naming a
 *     supplier we do not use is its own defect, and it is how the original copy
 *     was wrong.
 *   - Self-hosted engines are on the list. Vaultwarden and Stalwart are not
 *     sub-processors, so they are correctly absent from the disclosures — but
 *     naming them still describes our infrastructure to every CLI user.
 *   - Model names are on the list. "aura" or "kokoro" identifies the supplier
 *     as surely as the company name, which is why the API's own guard denies
 *     model names too.
 */
const FORBIDDEN_VENDORS: readonly string[] = [
	// Telephony.
	"telnyx",
	"twilio",
	// Speech — companies and the model names that identify them.
	"deepgram",
	"aura",
	"elevenlabs",
	"kokoro",
	// Vault and mail engines, self-hosted included.
	"bitwarden",
	"vaultwarden",
	"stalwart",
	"resend",
	// Language model.
	"gemini",
	// Postal validation — named in copy before any of it was integrated.
	"usps",
	"smarty",
];

describe("onboard capability matrix", () => {
	test("names no vendor", () => {
		// Guard the guard: an empty matrix or an empty denylist would satisfy
		// the loop below without checking anything. Same reason the next-step
		// test asserts ONBOARD_NEXT_STEPS.length first.
		expect(CAPABILITY_MATRIX.length).toBeGreaterThan(0);
		expect(FORBIDDEN_VENDORS.length).toBeGreaterThan(0);

		// Case-insensitive on purpose: the leak shipped as "Telnyx" in this
		// file and "TELNYX" on the wire, and a case-sensitive sweep of the repo
		// genuinely missed the uppercase form while auditing this very bug.
		const found = CAPABILITY_MATRIX.flatMap((line) => {
			const lower = line.toLowerCase();
			return FORBIDDEN_VENDORS.filter((vendor) => lower.includes(vendor)).map((vendor) => ({
				line,
				vendor,
			}));
		});

		// Name the culprit line and vendor rather than asserting a bare boolean —
		// same reason onboard-advertised.test.ts passes an object into expect().
		expect({ found }).toEqual({ found: [] });
	});
});
