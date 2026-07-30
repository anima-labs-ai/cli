/**
 * What a second `am init` does to the setup already on the machine.
 *
 * Re-running init used to overwrite `apiKey`, `defaultOrg` and
 * `defaultIdentity` in place. The previous agent kept working server-side, but
 * became unreachable from this machine: its key was gone and nothing recorded
 * that it had ever been configured. It also reset `outputFormat` to "table"
 * unconditionally, undoing `am config set outputFormat json` for anyone who
 * re-ran the wizard.
 *
 * Same-email sign-up is refused by the API, so this only bites the user who
 * onboards a *second* org with a different owner email — which is exactly the
 * user who still needs the first one.
 *
 * These call the helpers directly. The wizard around them is clack prompts,
 * which init.test.ts documents as not reliably mockable ("Mocking clack
 * reliably across the … single prompt() global"), so the prompt flow is
 * verified by hand and the credential handling is pinned here.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	getConfig,
	getAuthConfig,
	resetPathsCache,
	saveAuthConfig,
	saveConfig,
	setPathsOverride,
} from "../../lib/config.js";

const testConfigDir = join(import.meta.dir, ".test-init-existing-config");

mock.module("env-paths", () => ({
	default: () => ({
		config: testConfigDir,
		data: testConfigDir,
		cache: testConfigDir,
		log: testConfigDir,
		temp: testConfigDir,
	}),
}));

const { archiveCurrentSetup, currentSetup, masterCapability } = await import(
	"../../commands/init/index.js"
);

/**
 * Which credentials can create an agent.
 *
 * This shipped wrong: "Add another agent to this org" was offered, and
 * recommended by default, to every configured machine. Sign-up mints both an
 * `mk_` and an `ak_` for a new org but returns only the `ak_`, so an
 * init-provisioned machine — the one most likely to want a second agent — is
 * exactly the one that cannot create one. Users answered two prompts and then
 * got "Master key required for this operation" from the server.
 */
describe("which credentials can create an agent", () => {
	test("an agent key cannot — this is what init stores", () => {
		expect(masterCapability("ak_live_abc")).toBe("no");
	});

	test("a master key can", () => {
		expect(masterCapability("mk_live_abc")).toBe("yes");
	});

	test("an OAuth token is unknown — granted scopes are not stored locally", () => {
		// AuthConfig has no `scope` field, so admin:full cannot be checked
		// without asking the server. Guessing "no" would block a token that
		// works; guessing "yes" would restore the two-wasted-prompts bug.
		expect(masterCapability("oat_live_abc")).toBe("unknown");
	});

	test("no credential at all is unknown, not a hard no", () => {
		expect(masterCapability(undefined)).toBe("unknown");
	});
});

describe("a second init and the setup already on the machine", () => {
	beforeEach(() => {
		resetPathsCache();
		setPathsOverride({
			config: testConfigDir,
			data: testConfigDir,
			cache: testConfigDir,
			log: testConfigDir,
			temp: testConfigDir,
		});
		mkdirSync(testConfigDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testConfigDir)) rmSync(testConfigDir, { recursive: true, force: true });
	});

	test("a machine that was never set up reports nothing to preserve", async () => {
		expect(await currentSetup()).toBeNull();
		// Nothing to park, so no profile is invented for an empty config.
		expect(await archiveCurrentSetup()).toBeNull();
		expect((await getConfig()).profiles ?? {}).toEqual({});
	});

	test("an existing agent is recognised", async () => {
		await saveAuthConfig({ apiKey: "ak_live_1", apiUrl: "https://api.example", email: "a@b.c" });
		await saveConfig({ defaultOrg: "org_1", defaultIdentity: "agent_1" });

		expect(await currentSetup()).toMatchObject({
			apiKey: "ak_live_1",
			defaultOrg: "org_1",
			defaultIdentity: "agent_1",
			email: "a@b.c",
		});
	});

	test("the previous key is parked in a profile, not discarded", async () => {
		await saveAuthConfig({ apiKey: "ak_live_1", apiUrl: "https://api.example", email: "a@b.c" });
		await saveConfig({ defaultOrg: "org_1", defaultIdentity: "agent_1" });

		const name = await archiveCurrentSetup();

		// Named after the agent, because that id is what `--agent` and
		// `config set defaultIdentity` take — the name is also the way back.
		expect(name).toBe("agent_1");

		const profile = (await getConfig()).profiles?.[name as string];
		expect(profile).toMatchObject({
			apiKey: "ak_live_1",
			defaultOrg: "org_1",
			defaultIdentity: "agent_1",
		});
	});

	test("archiving twice does not overwrite the first archive", async () => {
		await saveAuthConfig({ apiKey: "ak_live_1", apiUrl: "https://api.example" });
		await saveConfig({ defaultOrg: "org_1", defaultIdentity: "agent_1" });
		const first = await archiveCurrentSetup();

		// Same identity still active (a failed or repeated run), so the name
		// collides. Losing the first archive here would defeat the point.
		const second = await archiveCurrentSetup();

		expect(first).toBe("agent_1");
		expect(second).toBe("agent_1-2");
		const profiles = (await getConfig()).profiles ?? {};
		expect(Object.keys(profiles).sort()).toEqual(["agent_1", "agent_1-2"]);
	});

	test("a configured output format survives being archived", async () => {
		await saveAuthConfig({ apiKey: "ak_live_1" });
		await saveConfig({ defaultIdentity: "agent_1", outputFormat: "json" });

		await archiveCurrentSetup();

		expect((await getConfig()).outputFormat).toBe("json");
		expect((await getConfig()).profiles?.agent_1?.outputFormat).toBe("json");
	});

	test("the active credentials are left alone — archiving copies, it does not move", async () => {
		await saveAuthConfig({ apiKey: "ak_live_1", apiUrl: "https://api.example" });
		await saveConfig({ defaultOrg: "org_1", defaultIdentity: "agent_1" });

		await archiveCurrentSetup();

		// The caller overwrites these immediately afterwards; archiving must not
		// pre-emptively clear them, or a failure between the two steps would
		// leave the machine with no credentials at all.
		expect((await getAuthConfig()).apiKey).toBe("ak_live_1");
		expect((await getConfig()).defaultIdentity).toBe("agent_1");
	});
});
