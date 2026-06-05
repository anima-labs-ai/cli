# Changelog

All notable changes to `@anima-labs/cli` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and release notes are grouped using Conventional Commits categories.

## [Unreleased]

### Added

- `anima verify <code>` — submit the verification OTP emailed to an agent's owner (POST `/v1/agent/verify`) to unlock full send capability. Previously `init` sent the OTP with no command to submit it, leaving the flow dead-ended.

### Changed

- `anima onboard`: when run interactively without credentials, it now launches `anima init` directly instead of just printing a command. Agent / non-interactive callers still receive a structured `needs_auth` payload (now pointing at `anima init`).
- `anima onboard`: a 404 from the API is now surfaced as "your CLI is out of date" with an upgrade hint, instead of an opaque "Route not found".
- `anima init`: the email prompt now reads "Agent owner's email" (the human who owns the agent), surfaces the `anima verify` step after sign-up, and notes that Vault + extra phone numbers unlock on Starter+.

## [0.1.0] - 2025-03-25

### Added

- Initial public release of `@anima-labs/cli` as a standalone package.
- Command groups: auth, identity, email, phone, vault, config, setup-mcp, extension, admin, and init.
- npm package metadata, changelog tracking, and smoke-test support for installation verification.

[0.1.0]: https://github.com/anima-labs-ai/cli/releases/tag/v0.1.0
