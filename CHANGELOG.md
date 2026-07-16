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

- `anima setup-mcp verify` now flags configs referencing the unpublished `@anima-labs/mcp-*` split packages as errors (with a migration hint) instead of reporting them as valid, and recognizes `npx @anima-labs/mcp` stdio configs.
- The published npm package no longer declares `@anima/contracts` (a monorepo-local `file:` path) in `dependencies` — that entry made `npm install @anima-labs/cli` fail on any machine without the monorepo checked out next to it. The contracts are now bundled into `dist/cli.js` at build time; registry dependencies are unchanged.
- `anima security events` / `anima security scan` resolve the organization client-side (`--org` flag, falling back to the configured default org) to match the API contract's required `orgId` path parameter.

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

- `anima setup-mcp verify --ping` now probes `{origin}/health`; the previous `/mcp/health` rewrite 404'd against every endpoint, so `--ping` always reported remote configs as unreachable.
- `anima security scan` / `anima security events` without `--org` now derive the organization from auth (via org.me) as the flag help always promised, instead of sending an invalid request.

## [0.1.0] - 2025-03-25

### Added

- Initial public release of `@anima-labs/cli` as a standalone package.
- Command groups: auth, identity, email, phone, vault, config, setup-mcp, extension, admin, and init.
- npm package metadata, changelog tracking, and smoke-test support for installation verification.

[0.1.0]: https://github.com/anima-labs-ai/cli/releases/tag/v0.1.0
