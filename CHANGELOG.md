# Changelog

All notable changes to `@anima-labs/cli` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and release notes are grouped using Conventional Commits categories.

Releases 0.2.x through 0.6.4 shipped without changelog entries; the record resumes at 0.6.5. Sections below were reconstructed from the commits that introduced each entry, matched to the first tag containing them, and the entry text is unchanged from when it was written.

## [Unreleased]

_Nothing yet._

## [0.7.0] - 2026-08-04

### Removed

- **`--no-scrub` is gone from every command that had it.** It disabled stdout/stderr secret scrubbing, which is the one thing standing between a vault secret and the terminal. A flag whose only effect is to print secrets should not exist; there is no replacement.
- **`anima vault store --password` and `--key` are removed.** Passing a secret as an argv value leaks it to the process table, the shell history file and any `ps`-reading sibling process. Use `--password-stdin` / `--key-stdin`, which read the secret from stdin and never materialize it in an inspectable place.
- **`anima vault reload` is removed.** It forced a server-side snapshot cache refresh that no longer exists; the command had been a no-op that reported success.
- **`anima inbox update --unlink-agent` is removed.** An inbox now belongs to exactly one agent, so there is no unlinked state to set it to — the API dropped `agentId`'s nullability and a `null` is rejected. `--agent <id>` still moves an inbox to a different agent (409 if that agent already has one).

### Added

- `anima request vault|phone` — ask the agent's owner to provision a vault or a phone number, for the case where the agent hits a capability it is not allowed to grant itself. The owner is emailed and approves or declines in the console. Declines are soft (the agent may ask again) and a pending request expires after 7 days.
- `anima request list|status|cancel` — inspect and withdraw the agent's own requests. `anima request approve|decline` are owner-side and require a master key.
- `anima vault store --password-stdin` / `--key-stdin` — read the secret from stdin instead of argv.
- `anima init` now asks whether to provision a vault and creates the first one during sign-up, closing the dead end where a fresh agent could neither use a vault nor provision one (vault provisioning is master-key-gated by design).

### Fixed

- `anima request cancel` sent a body-less POST that the API answered with a 500; it now sends the empty object the route expects.
- `anima vault audit --check` no longer reports success when the path it was given does not exist, `--fix` actually writes its fixes, and unresolved vault references are surfaced rather than silently counted as clean.
- `anima vault inject` and `anima vault exec --config` now fail loud on an unreadable or malformed config instead of continuing with an empty environment.
- `anima daemon status` / `stop` no longer exit silently when no daemon is running, and every id-taking argument now rejects an empty string.

## [0.6.10] - 2026-08-04

### Changed

- **`anima identity` is now `anima agent`.** The CLI called them identities while the API, the docs and everyone talking about the product called them agents — and `anima identity create` created an agent. `identity` and the short `id` remain as aliases, so published docs, skill manifests and existing scripts keep working. Help text follows: "Create an agent", not "Create an identity". DID and verifiable-credential wording is unchanged, since those genuinely are about identity documents.

### CI

- **A single `process.exit` no longer ends the whole test run.** `bun test` runs every file in one process, so one command's `process.exit(0)` terminated the runner partway through — turning an already-recorded failure green and silently skipping every file after it. A preload replaces `process.exit` with a throw for the duration of the suite; verified by deleting `bunfig.toml` and watching the guard test fail.

### Added

- **`anima auth elevate` — admin access without leaving the terminal.** Commands that need master rights (creating an agent, rotating keys, `anima tail`) now step up on demand: macOS asks for your login password and the command proceeds. The first step-up emails a code to the organization owner and **enrols the machine**, storing a grant in the keychain with an empty trusted-application list, so later step-ups need no email. A step-up lasts 15 minutes like `sudo`, so a run of admin commands prompts once. An agent driving the CLI holds the API key and can run every command, but cannot answer a system dialog — that is the boundary. Two honest limits: the gate is **local** (the server cannot verify a human was present, so a grant already extracted still works elsewhere), and enrolment is **macOS-only** — DPAPI and libsecret encrypt at rest but release to anything running as the user, so the CLI refuses to store a grant there rather than pretend it is protected, and those platforms keep using the emailed code. Requires the owner-grant endpoints (anima#438).
- `anima config profile clear` — stop using the active profile and fall back to top-level config, **without deleting it**. There was previously no way back: "normal" is `activeProfile` being unset, and only `profile delete` produced that state, by destroying the profile and its credential.
- `anima identity use <id>` — set the default agent for later commands, validated against the agents you can actually see.

### Fixed

- **The machine-readable path is chosen by the resolved format, not the `--json` flag.** `resolveFormat` supports six formats and defaults to `agent` whenever stdout is not a TTY, so `--json` is one of five ways to ask for structure and not the common one — every piped invocation had it undefined. 108 command files branched on that flag anyway, which sent `anima … | jq` down the *human* path where `output.info()` prints nothing. That was silent data loss rather than a cosmetic difference: `address validate` dropped the API's suggested corrections entirely, so an agent asking why an address failed got `{"status":"error"}` and none of the fixes. Commands whose plain output is *already* a machine payload — `config get`, `vault use`, `vault inject`, `vault redact` — keep the envelope opt-in, because `ORG=$(anima config get defaultOrg)` and `anima vault use … > out.bin` break the moment the payload is wrapped. A source guard now fails the build if a command reintroduces the flag branch.

- **`anima voice transcript --speaker agent` filters for machine callers too.** The filter ran after the structured-output return, so `--json` had always returned both speakers — a filter explicitly requested and silently ignored.

- **`anima voice place` tells the truth about which gates run.** Its help advertised reassigned-number (RND) and time-of-day gates as server-side checks. Neither runs — the RND lookup is disabled in production and local time is never computed — and Do-Not-Call registries are never queried either: the `telemarketing_with_dnc_scrub` consent basis records that *you* scrubbed, it does not perform one. All three obligations stay with the caller, and the command no longer implies otherwise.

- **The two 402s from `voice place` are told apart.** A per-plan call cap and a voice spend ceiling both return 402 with opposite remedies — one clears next billing cycle, the other does not — and the CLI printed "wait for the next cycle" for both, sending someone away for a month when they needed to raise a dollar limit. The server says which in `details.resource`; the CLI now reads it.

- **`--agent` falls back to the configured default identity.** `anima init` signs off by telling you to run `anima email send --to … --subject … --body …`, and that command answered `error: required option '--agent <id>' not specified` — the very first thing onboarding asks a new user to do. The id was not missing: init had just written `defaultIdentity` to config.json and `config list` printed it, but nothing ever read it back. 17 commands whose `--agent` means "the agent I am acting as" now resolve it from flag > env > profile > config, and say on stderr which layer answered when it did not come from the command line. The ~33 already-optional ones are deliberately untouched: their absent value means "infer from the agent-scoped key", and filling it in could start sending an id that disagrees with the key authenticating the call.
- **The active profile now actually supplies the credential.** `anima config profile use <name>` and `anima auth elevate` both marked a profile active while every request continued to go out under `auth.json`'s key — profiles lived in a separate keychain namespace that nothing in the credential path read. Exactly two callers touched a profile's `apiKey`: one printed it masked, the other read the previous profile's *name*. The visible symptom was `anima tail` reporting "master key required" immediately after a successful elevation, with the working master key sitting unused in the keychain. The profile's `apiUrl` now travels with its key so a staging credential cannot be sent to production, and a stored OAuth session no longer outranks the profile you just selected. A privileged session that has lapsed — or was written before expiries were recorded — stands down with an explanation instead of turning into an unexplained 401 on every later command.
- **`--org` falls back to the configured default**, like `--agent`. `anima identity create` answered `required option '--org <orgId>' not specified` to users who had just run `anima init`, which writes `defaultOrg`; `.requiredOption()` is enforced during parse, so the command was rejected before its action body could read the value the CLI already had. `anima admin key-rotate` likewise. `anima a2a send --agent` deliberately stays mandatory — it names a destination, and quietly defaulting a target to yourself succeeds at the wrong thing.
- **`anima tail --agent <id>` now filters.** It sent `agentId` where the server reads `agent_id`, so the parameter was dropped and the stream carried the whole organization — while the header line echoed the requested agent back. `anima tail` also ignored `--api-url`/`ANIMA_API_URL` entirely, and lost the path from a path-mounted API URL.
- `anima init` on an already-onboarded machine shows the current setup and offers to add an agent to the existing org, instead of silently overwriting the config. The add-agent branch recognises an enrolled machine rather than refusing on the key prefix.
- `anima auth elevate` no longer signs off with `anima config profile use default`, a command that could only answer `Profile "default" does not exist`.
- A typed refusal is no longer overridden by a per-status guess: a 403 carrying `MASTER_KEY_REQUIRED` displayed as "you do not have access to this organization" — not just vaguer but false, sending people after a permissions problem that did not exist.
- `anima admin org list`, `anima admin usage`, `anima admin key-rotate` and `anima admin key-revoke` point at endpoints that exist (`/orgs/me`, `/orgs/me/usage`, `/orgs/{id}/rotate-key`, `DELETE /api-keys/{id}`) instead of a `/v1/admin/*` namespace the API never had. `anima admin member invite|role` now explain that membership is managed in Clerk rather than answering "Route not found".

## [0.6.9] - 2026-07-17

### Added

- `anima message label <id> --add <label> --remove <label>` — add and/or remove workflow labels on one message (PATCH `/v1/messages/{id}/labels`, spec B3). System labels are `unread`/`read` (adding `read` clears `unread` and vice versa), `archived`, and `spam`; any other value is your own tag. Add/remove, never a whole-array set, so two agents sharing an inbox can't erase each other's tags; a call with neither `--add` nor `--remove` is refused rather than sent as an empty no-op.
- **Label filters on `message list`, `message search`, `email list`, and `email search`** — `--label <label>` (repeat to require ALL, e.g. `--label unread --label urgent`) and `--include-spam` (spam is excluded by default). `email search` accepts them in full-text mode only and refuses them under `--semantic`, where the endpoint cannot filter by label and would silently ignore them. `list`, `search`, and `get` now show a message's labels in human output.

### Fixed

- **An empty id is now a usage error instead of an API failure.** `anima email draft get ""` reported `Failed to get draft: Cannot read properties of undefined (reading 'length')` — an internal TypeError dressed up as a server error, blaming the API for a usage mistake. An empty id collapses the request path (`/email/drafts/{id}` → `/email/drafts/`), which the API resolves to the *list* route and answers 200 with a list payload; rendering that as a single resource then dies on a missing field. Destructive commands failed worse and more quietly: `anima identity delete --id ""` printed `Identity deleted: ` and exited 0 for a delete that never happened. All 65 required id inputs — positional (`<id>`, `<callId>`, `<credentialId>`, …) and option (`--id`, `--agent`, `--org`, `--did`, …) — now reject an empty value before any request is made, reported in the same shape as a missing argument: `error: option '--id <id>' argument '' is invalid. Identity ID cannot be empty.` Inputs where empty can be legitimate (`config set <value>`, `<query>`, `--input <json>`) are deliberately unaffected.
- **Commands that report an error now exit non-zero.** `anima config set <bad-key>`, `config get <unset-key>`, `config profile use|delete <unknown>`, `setup-mcp verify` (when a client has issues), and `address validate` (when the address is invalid) all printed `{"status":"error", …}` and then exited **0** — so `set -e` scripts, CI steps, and `cmd && next` could not detect the failure. `setup-mcp verify` was the sharpest case: a command whose exit code is its entire scriptable contract, where `setup-mcp verify || exit 1` could never fail. `verify` and `address validate` also returned early in `--json` mode before the verdict was consulted, so the mode a script is most likely to use was the one that always reported success. Exit codes follow the convention already used across the CLI: **2** when the input was bad (an invalid config key, like `generate`/`completion` reject an unknown kind/shell), **1** when the input was fine but the operation failed or the lookup missed (matching `git config --get`).
  - Potentially breaking for scripts that relied on the old behavior: `VAL=$(anima config get defaultOrg)` under `set -e` now aborts on an unset key instead of continuing with an empty string.

## [0.6.8] - 2026-07-17

### Added

- `anima email draft create|get|list|send|delete` — email drafts (`/v1/email/drafts`). Drafts may be incomplete (only `--agent` is required at create); `send` atomically converts the draft into a real message (email.send semantics — threading, scanning, limits) and deletes the draft, returning the new message id. Closes the drafts gap with the MCP surface (C5).
- `anima email search <query>` — full-text search over your emails (POST `/v1/messages/search`, scoped to the EMAIL channel; use `anima message search` for other channels). Add `--semantic` to rank by embedding similarity instead (POST `/v1/messages/search/semantic`, `--threshold` 0–1, limit 1–50); an embedding-provider outage (503) is reported as such rather than as "no matches". Mode-specific flags fail loudly in the wrong mode. The first-run `anima demo` advertises email search again — truthfully this time (B11).

## [0.6.7] - 2026-07-16

### Added

- `anima inbox create|get|list|update|delete` — manage email inboxes (POST/GET/PATCH/DELETE `/v1/inboxes`). Create takes `--username`, `--domain`, `--display-name`, and `--agent`; update supports clearing fields via `--clear-display-name` / `--unlink-agent`. Closes the CLI gap with the SDK and MCP surfaces.

## [0.6.6] - 2026-07-16

### Changed

- **`anima setup-mcp install` defaults to `--mode remote`** (the hosted gateway `https://mcp.useanima.sh/mcp`). The previous default, stdio, wrote configs pointing at five per-domain npm packages (`@anima-labs/mcp-agent`, `-email`, `-phone`, `-vault`, `-platform`) that were never published — every fresh install produced configs that could not resolve.
- `anima setup-mcp install --mode stdio` now targets the one published package, `@anima-labs/mcp`, as a single unified `anima` entry. The `--server` per-domain filter is removed along with the split; an unknown `--mode` value is now rejected instead of silently coercing to stdio.
- `anima demo` advertises only commands that actually exist (`email send --agent/--to/--subject/--body`, `email list`, `email get`). The fictional `email search`, `email reply`, `--text`/`--test` flags, and the entire `x402` flow (out of scope) are gone, along with the `--only-email`/`--only-x402` options; the demo is explicitly labeled a local simulation.

### CI

- Release and CI workflows fail if the rebrand-mangle token (`useanima.sh` + `s`, the mangled `anima.emails.*` identifier) appears anywhere in the repo.
- Releases dispatch a Homebrew tap update (`anima-labs-ai/homebrew-tap`) after npm publish when `HOMEBREW_TAP_TOKEN` is configured; the tap also self-updates on a schedule.

### Fixed

- `anima setup-mcp verify` now flags configs referencing the unpublished `@anima-labs/mcp-*` split packages as errors (with a migration hint) instead of reporting them as valid, and recognizes `npx @anima-labs/mcp` stdio configs.

## [0.6.5] - 2026-07-06

### Added

- `anima verify <code>` — submit the verification OTP emailed to an agent's owner (POST `/v1/agent/verify`) to unlock full send capability. Previously `init` sent the OTP with no command to submit it, leaving the flow dead-ended.

### Changed

- `anima onboard`: when run interactively without credentials, it now launches `anima init` directly instead of just printing a command. Agent / non-interactive callers still receive a structured `needs_auth` payload (now pointing at `anima init`).
- `anima onboard`: a 404 from the API is now surfaced as "your CLI is out of date" with an upgrade hint, instead of an opaque "Route not found".
- `anima onboard`: the `identity` block now reports whether the agent is verified (`verified` + `auth_type`, from `/v1/agent/status`); when unverified, the `anima verify` step leads the next-steps. Best-effort and agent-keys only.
- `anima init`: the email prompt now reads "Agent owner's email" (the human who owns the agent), surfaces the `anima verify` step after sign-up, and notes that Vault + extra phone numbers unlock on Starter+.
- `anima setup-mcp install --mode remote` now writes a single unified `anima` entry pointing at the hosted gateway `https://mcp.useanima.sh/mcp` instead of five per-domain entries pointing at internal Cloud Run URLs. `--server` is rejected in remote mode (the gateway serves every domain at one endpoint); stdio mode is unchanged.
- README and `anima onboard` no longer claim an `anima --mcp` server mode (which never existed) or Codex/Zed auto-configuration; the supported MCP clients are Claude Desktop, Claude Code, Cursor, Windsurf, and VS Code.

### Fixed

- The published npm package no longer declares `@anima/contracts` (a monorepo-local `file:` path) in `dependencies` — that entry made `npm install @anima-labs/cli` fail on any machine without the monorepo checked out next to it. The contracts are now bundled into `dist/cli.js` at build time; registry dependencies are unchanged.
- `anima security events` / `anima security scan` resolve the organization client-side (`--org` flag, falling back to the configured default org) to match the API contract's required `orgId` path parameter.
- `anima setup-mcp verify --ping` now probes `{origin}/health`; the previous `/mcp/health` rewrite 404'd against every endpoint, so `--ping` always reported remote configs as unreachable.
- `anima security scan` / `anima security events` without `--org` now derive the organization from auth (via org.me) as the flag help always promised, instead of sending an invalid request.

## [0.1.0] - 2025-03-25

### Added

- Initial public release of `@anima-labs/cli` as a standalone package.
- Command groups: auth, identity, email, phone, vault, config, setup-mcp, extension, admin, and init.
- npm package metadata, changelog tracking, and smoke-test support for installation verification.

[Unreleased]: https://github.com/anima-labs-ai/cli/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/anima-labs-ai/cli/releases/tag/v0.7.0
[0.6.10]: https://github.com/anima-labs-ai/cli/releases/tag/v0.6.10
[0.6.9]: https://github.com/anima-labs-ai/cli/releases/tag/v0.6.9
[0.6.8]: https://github.com/anima-labs-ai/cli/releases/tag/v0.6.8
[0.6.7]: https://github.com/anima-labs-ai/cli/releases/tag/v0.6.7
[0.6.6]: https://github.com/anima-labs-ai/cli/releases/tag/v0.6.6
[0.6.5]: https://github.com/anima-labs-ai/cli/releases/tag/v0.6.5
[0.1.0]: https://github.com/anima-labs-ai/cli/releases/tag/v0.1.0
