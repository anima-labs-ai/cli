# Changelog

All notable changes to `@anima-labs/cli` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and release notes are grouped using Conventional Commits categories.

## [Unreleased]

### Changed

- **`anima setup-mcp install` defaults to `--mode remote`** (the hosted gateway `https://mcp.useanima.sh/mcp`). The previous default, stdio, wrote configs pointing at five per-domain npm packages (`@anima-labs/mcp-agent`, `-email`, `-phone`, `-vault`, `-platform`) that were never published — every fresh install produced configs that could not resolve.
- `anima setup-mcp install --mode stdio` now targets the one published package, `@anima-labs/mcp`, as a single unified `anima` entry. The `--server` per-domain filter is removed along with the split; an unknown `--mode` value is now rejected instead of silently coercing to stdio.
- `anima demo` advertises only commands that actually exist (`email send --agent/--to/--subject/--body`, `email list`, `email get`). The fictional `email search`, `email reply`, `--text`/`--test` flags, and the entire `x402` flow (out of scope) are gone, along with the `--only-email`/`--only-x402` options; the demo is explicitly labeled a local simulation.

### CI

- Release and CI workflows fail if the rebrand-mangle token (`useanima.sh` + `s`, the mangled `anima.emails.*` identifier) appears anywhere in the repo.
- Releases dispatch a Homebrew tap update (`anima-labs-ai/homebrew-tap`) after npm publish when `HOMEBREW_TAP_TOKEN` is configured; the tap also self-updates on a schedule.

### Fixed

- **An empty id is now a usage error instead of an API failure.** `anima email draft get ""` reported `Failed to get draft: Cannot read properties of undefined (reading 'length')` — an internal TypeError dressed up as a server error, blaming the API for a usage mistake. An empty id collapses the request path (`/email/drafts/{id}` → `/email/drafts/`), which the API resolves to the *list* route and answers 200 with a list payload; rendering that as a single resource then dies on a missing field. Destructive commands failed worse and more quietly: `anima identity delete --id ""` printed `Identity deleted: ` and exited 0 for a delete that never happened. All 65 required id inputs — positional (`<id>`, `<callId>`, `<credentialId>`, …) and option (`--id`, `--agent`, `--org`, `--did`, …) — now reject an empty value before any request is made, reported in the same shape as a missing argument: `error: option '--id <id>' argument '' is invalid. Identity ID cannot be empty.` Inputs where empty can be legitimate (`config set <value>`, `<query>`, `--input <json>`) are deliberately unaffected.
- **Commands that report an error now exit non-zero.** `anima config set <bad-key>`, `config get <unset-key>`, `config profile use|delete <unknown>`, `setup-mcp verify` (when a client has issues), and `address validate` (when the address is invalid) all printed `{"status":"error", …}` and then exited **0** — so `set -e` scripts, CI steps, and `cmd && next` could not detect the failure. `setup-mcp verify` was the sharpest case: a command whose exit code is its entire scriptable contract, where `setup-mcp verify || exit 1` could never fail. `verify` and `address validate` also returned early in `--json` mode before the verdict was consulted, so the mode a script is most likely to use was the one that always reported success. Exit codes follow the convention already used across the CLI: **2** when the input was bad (an invalid config key, like `generate`/`completion` reject an unknown kind/shell), **1** when the input was fine but the operation failed or the lookup missed (matching `git config --get`).
  - Potentially breaking for scripts that relied on the old behavior: `VAL=$(anima config get defaultOrg)` under `set -e` now aborts on an unset key instead of continuing with an empty string.
- `anima setup-mcp verify` now flags configs referencing the unpublished `@anima-labs/mcp-*` split packages as errors (with a migration hint) instead of reporting them as valid, and recognizes `npx @anima-labs/mcp` stdio configs.
- The published npm package no longer declares `@anima/contracts` (a monorepo-local `file:` path) in `dependencies` — that entry made `npm install @anima-labs/cli` fail on any machine without the monorepo checked out next to it. The contracts are now bundled into `dist/cli.js` at build time; registry dependencies are unchanged.
- `anima security events` / `anima security scan` resolve the organization client-side (`--org` flag, falling back to the configured default org) to match the API contract's required `orgId` path parameter.

### Added

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
