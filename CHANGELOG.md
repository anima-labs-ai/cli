# Changelog

All notable changes to `@anima-labs/cli` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and release notes are grouped using Conventional Commits categories.

## [Unreleased]

### Changed

- **`anima identity` is now `anima agent`.** The CLI called them identities while the API, the docs and everyone talking about the product called them agents — and `anima identity create` created an agent. `identity` and the short `id` remain as aliases, so published docs, skill manifests and existing scripts keep working. Help text follows: "Create an agent", not "Create an identity". DID and verifiable-credential wording is unchanged, since those genuinely are about identity documents.

- **`anima setup-mcp install` defaults to `--mode remote`** (the hosted gateway `https://mcp.useanima.sh/mcp`). The previous default, stdio, wrote configs pointing at five per-domain npm packages (`@anima-labs/mcp-agent`, `-email`, `-phone`, `-vault`, `-platform`) that were never published — every fresh install produced configs that could not resolve.
- `anima setup-mcp install --mode stdio` now targets the one published package, `@anima-labs/mcp`, as a single unified `anima` entry. The `--server` per-domain filter is removed along with the split; an unknown `--mode` value is now rejected instead of silently coercing to stdio.
- `anima demo` advertises only commands that actually exist (`email send --agent/--to/--subject/--body`, `email list`, `email get`). The fictional `email search`, `email reply`, `--text`/`--test` flags, and the entire `x402` flow (out of scope) are gone, along with the `--only-email`/`--only-x402` options; the demo is explicitly labeled a local simulation.

### CI

- **A single `process.exit` no longer ends the whole test run.** `bun test` runs every file in one process, so one command's `process.exit(0)` terminated the runner partway through — turning an already-recorded failure green and silently skipping every file after it. A preload replaces `process.exit` with a throw for the duration of the suite; verified by deleting `bunfig.toml` and watching the guard test fail.

- Release and CI workflows fail if the rebrand-mangle token (`useanima.sh` + `s`, the mangled `anima.emails.*` identifier) appears anywhere in the repo.
- Releases dispatch a Homebrew tap update (`anima-labs-ai/homebrew-tap`) after npm publish when `HOMEBREW_TAP_TOKEN` is configured; the tap also self-updates on a schedule.

### Fixed

- **`--agent` falls back to the configured default identity.** `anima init` signs off by telling you to run `anima email send --to … --subject … --body …`, and that command answered `error: required option '--agent <id>' not specified` — the very first thing onboarding asks a new user to do. The id was not missing: init had just written `defaultIdentity` to config.json and `config list` printed it, but nothing ever read it back. 17 commands whose `--agent` means "the agent I am acting as" now resolve it from flag > env > profile > config, and say on stderr which layer answered when it did not come from the command line. The ~33 already-optional ones are deliberately untouched: their absent value means "infer from the agent-scoped key", and filling it in could start sending an id that disagrees with the key authenticating the call.
- **The active profile now actually supplies the credential.** `anima config profile use <name>` and `anima auth elevate` both marked a profile active while every request continued to go out under `auth.json`'s key — profiles lived in a separate keychain namespace that nothing in the credential path read. Exactly two callers touched a profile's `apiKey`: one printed it masked, the other read the previous profile's *name*. The visible symptom was `anima tail` reporting "master key required" immediately after a successful elevation, with the working master key sitting unused in the keychain. The profile's `apiUrl` now travels with its key so a staging credential cannot be sent to production, and a stored OAuth session no longer outranks the profile you just selected. A privileged session that has lapsed — or was written before expiries were recorded — stands down with an explanation instead of turning into an unexplained 401 on every later command.
- **`--org` falls back to the configured default**, like `--agent`. `anima identity create` answered `required option '--org <orgId>' not specified` to users who had just run `anima init`, which writes `defaultOrg`; `.requiredOption()` is enforced during parse, so the command was rejected before its action body could read the value the CLI already had. `anima admin key-rotate` likewise. `anima a2a send --agent` deliberately stays mandatory — it names a destination, and quietly defaulting a target to yourself succeeds at the wrong thing.
- **`anima tail --agent <id>` now filters.** It sent `agentId` where the server reads `agent_id`, so the parameter was dropped and the stream carried the whole organization — while the header line echoed the requested agent back. `anima tail` also ignored `--api-url`/`ANIMA_API_URL` entirely, and lost the path from a path-mounted API URL.
- `anima init` on an already-onboarded machine shows the current setup and offers to add an agent to the existing org, instead of silently overwriting the config. The add-agent branch recognises an enrolled machine rather than refusing on the key prefix.
- `anima auth elevate` no longer signs off with `anima config profile use default`, a command that could only answer `Profile "default" does not exist`.
- A typed refusal is no longer overridden by a per-status guess: a 403 carrying `MASTER_KEY_REQUIRED` displayed as "you do not have access to this organization" — not just vaguer but false, sending people after a permissions problem that did not exist.
- `anima admin org list`, `anima admin usage`, `anima admin key-rotate` and `anima admin key-revoke` point at endpoints that exist (`/orgs/me`, `/orgs/me/usage`, `/orgs/{id}/rotate-key`, `DELETE /api-keys/{id}`) instead of a `/v1/admin/*` namespace the API never had. `anima admin member invite|role` now explain that membership is managed in Clerk rather than answering "Route not found".
- **An empty id is now a usage error instead of an API failure.** `anima email draft get ""` reported `Failed to get draft: Cannot read properties of undefined (reading 'length')` — an internal TypeError dressed up as a server error, blaming the API for a usage mistake. An empty id collapses the request path (`/email/drafts/{id}` → `/email/drafts/`), which the API resolves to the *list* route and answers 200 with a list payload; rendering that as a single resource then dies on a missing field. Destructive commands failed worse and more quietly: `anima identity delete --id ""` printed `Identity deleted: ` and exited 0 for a delete that never happened. All 65 required id inputs — positional (`<id>`, `<callId>`, `<credentialId>`, …) and option (`--id`, `--agent`, `--org`, `--did`, …) — now reject an empty value before any request is made, reported in the same shape as a missing argument: `error: option '--id <id>' argument '' is invalid. Identity ID cannot be empty.` Inputs where empty can be legitimate (`config set <value>`, `<query>`, `--input <json>`) are deliberately unaffected.
- **Commands that report an error now exit non-zero.** `anima config set <bad-key>`, `config get <unset-key>`, `config profile use|delete <unknown>`, `setup-mcp verify` (when a client has issues), and `address validate` (when the address is invalid) all printed `{"status":"error", …}` and then exited **0** — so `set -e` scripts, CI steps, and `cmd && next` could not detect the failure. `setup-mcp verify` was the sharpest case: a command whose exit code is its entire scriptable contract, where `setup-mcp verify || exit 1` could never fail. `verify` and `address validate` also returned early in `--json` mode before the verdict was consulted, so the mode a script is most likely to use was the one that always reported success. Exit codes follow the convention already used across the CLI: **2** when the input was bad (an invalid config key, like `generate`/`completion` reject an unknown kind/shell), **1** when the input was fine but the operation failed or the lookup missed (matching `git config --get`).
  - Potentially breaking for scripts that relied on the old behavior: `VAL=$(anima config get defaultOrg)` under `set -e` now aborts on an unset key instead of continuing with an empty string.
- `anima setup-mcp verify` now flags configs referencing the unpublished `@anima-labs/mcp-*` split packages as errors (with a migration hint) instead of reporting them as valid, and recognizes `npx @anima-labs/mcp` stdio configs.
- The published npm package no longer declares `@anima/contracts` (a monorepo-local `file:` path) in `dependencies` — that entry made `npm install @anima-labs/cli` fail on any machine without the monorepo checked out next to it. The contracts are now bundled into `dist/cli.js` at build time; registry dependencies are unchanged.
- `anima security events` / `anima security scan` resolve the organization client-side (`--org` flag, falling back to the configured default org) to match the API contract's required `orgId` path parameter.

### Added

- **`anima auth elevate` — admin access without leaving the terminal.** Commands that need master rights (creating an agent, rotating keys, `anima tail`) now step up on demand: macOS asks for your login password and the command proceeds. The first step-up emails a code to the organization owner and **enrols the machine**, storing a grant in the keychain with an empty trusted-application list, so later step-ups need no email. A step-up lasts 15 minutes like `sudo`, so a run of admin commands prompts once. An agent driving the CLI holds the API key and can run every command, but cannot answer a system dialog — that is the boundary. Two honest limits: the gate is **local** (the server cannot verify a human was present, so a grant already extracted still works elsewhere), and enrolment is **macOS-only** — DPAPI and libsecret encrypt at rest but release to anything running as the user, so the CLI refuses to store a grant there rather than pretend it is protected, and those platforms keep using the emailed code. Requires the owner-grant endpoints (anima#438).
- `anima config profile clear` — stop using the active profile and fall back to top-level config, **without deleting it**. There was previously no way back: "normal" is `activeProfile` being unset, and only `profile delete` produced that state, by destroying the profile and its credential.
- `anima identity use <id>` — set the default agent for later commands, validated against the agents you can actually see.


- `anima message label <id> --add <label> --remove <label>` — add and/or remove workflow labels on one message (PATCH `/v1/messages/{id}/labels`, spec B3). System labels are `unread`/`read` (adding `read` clears `unread` and vice versa), `archived`, and `spam`; any other value is your own tag. Add/remove, never a whole-array set, so two agents sharing an inbox can't erase each other's tags; a call with neither `--add` nor `--remove` is refused rather than sent as an empty no-op.
- **Label filters on `message list`, `message search`, `email list`, and `email search`** — `--label <label>` (repeat to require ALL, e.g. `--label unread --label urgent`) and `--include-spam` (spam is excluded by default). `email search` accepts them in full-text mode only and refuses them under `--semantic`, where the endpoint cannot filter by label and would silently ignore them. `list`, `search`, and `get` now show a message's labels in human output.
- `anima email draft create|get|list|send|delete` — email drafts (`/v1/email/drafts`). Drafts may be incomplete (only `--agent` is required at create); `send` atomically converts the draft into a real message (email.send semantics — threading, scanning, limits) and deletes the draft, returning the new message id. Closes the drafts gap with the MCP surface (C5).
- `anima email search <query>` — full-text search over your emails (POST `/v1/messages/search`, scoped to the EMAIL channel; use `anima message search` for other channels). Add `--semantic` to rank by embedding similarity instead (POST `/v1/messages/search/semantic`, `--threshold` 0–1, limit 1–50); an embedding-provider outage (503) is reported as such rather than as "no matches". Mode-specific flags fail loudly in the wrong mode. The first-run `anima demo` advertises email search again — truthfully this time (B11).
- `anima inbox create|get|list|update|delete` — manage email inboxes (POST/GET/PATCH/DELETE `/v1/inboxes`). Create takes `--username`, `--domain`, `--display-name`, and `--agent`; update supports clearing fields via `--clear-display-name` / `--unlink-agent`. Closes the CLI gap with the SDK and MCP surfaces.
- `anima verify <code>` — submit the verification OTP emailed to an agent's owner (POST `/v1/agent/verify`) to unlock full send capability. Previously `init` sent the OTP with no command to submit it, leaving the flow dead-ended.

### Changed

- `anima onboard`: when run interactively without credentials, it now launches `anima init` directly instead of just printing a command. Agent / non-interactive callers still receive a structured `needs_auth` payload (now pointing at `anima init`).
- `anima onboard`: a 404 from the API is now surfaced as "your CLI is out of date" with an upgrade hint, instead of an opaque "Route not found".
- `anima onboard`: the `identity` block now reports whether the agent is verified (`verified` + `auth_type`, from `/v1/agent/status`); when unverified, the `anima verify` step leads the next-steps. Best-effort and agent-keys only.
- `anima init`: the email prompt now reads "Agent owner's email" (the human who owns the agent), surfaces the `anima verify` step after sign-up, and notes that Vault + extra phone numbers unlock on Starter+.
- `anima setup-mcp install --mode remote` now writes a single unified `anima` entry pointing at the hosted gateway `https://mcp.useanima.sh/mcp` instead of five per-domain entries pointing at internal Cloud Run URLs. `--server` is rejected in remote mode (the gateway serves every domain at one endpoint); stdio mode is unchanged.
- README and `anima onboard` no longer claim an `anima --mcp` server mode (which never existed) or Codex/Zed auto-configuration; the supported MCP clients are Claude Desktop, Claude Code, Cursor, Windsurf, and VS Code.

### Fixed

- `anima setup-mcp verify --ping` now probes `{origin}/health`; the previous `/mcp/health` rewrite 404'd against every endpoint, so `--ping` always reported remote configs as unreachable.
- `anima security scan` / `anima security events` without `--org` now derive the organization from auth (via org.me) as the flag help always promised, instead of sending an invalid request.

## [0.1.0] - 2025-03-25

### Added

- Initial public release of `@anima-labs/cli` as a standalone package.
- Command groups: auth, identity, email, phone, vault, config, setup-mcp, extension, admin, and init.
- npm package metadata, changelog tracking, and smoke-test support for installation verification.

[0.1.0]: https://github.com/anima-labs-ai/cli/releases/tag/v0.1.0
