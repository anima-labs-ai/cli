# Security

The Anima CLI is installed and executed by AI agents — inside containers, CI runners, and sandboxed runtimes — not by humans double-clicking installers. This document describes the security model with that deployment target in mind, and it explains exactly how to verify a release from an automation pipeline.

If you are integrating `anima` into an agent runtime and need a human-readable procurement answer, reach out to **security@useanima.sh**.

## Reporting a Vulnerability

Please report security issues privately via GitHub Security Advisories: <https://github.com/anima-labs-ai/cli/security/advisories/new>.

If you do not receive an acknowledgement within 2 business days, escalate to **security@useanima.sh** (PGP key: [useanima.sh/.well-known/gpg-key.asc](https://useanima.sh/.well-known/gpg-key.asc)).

We run a public bug bounty for the CLI and the Vault — scope, rewards, and safe-harbor terms are at <https://useanima.sh/security/bounty>.

We **do not accept AI-generated reports without a human-verified proof-of-concept**. Automated scanner output pasted verbatim will be closed without comment.

---

## Distribution Targets

The CLI ships for two audiences, both automated:

| Channel              | Target                                         | Why                                                                                                                           |
|----------------------|------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| npm (`@anima-labs/cli`) | Node/TS agent projects                      | Dependency-pinnable, provenance-attested, works wherever your agent already has `npm`/`bun`.                                  |
| Signed Linux binaries   | Containers, VMs, CI runners, shell scripts  | Static, no runtime needed. Installed in Dockerfiles and CI steps via `curl … \| sh` with Sigstore verification on every fetch. |

macOS and Windows binaries are **not** shipped. Agent workloads run on Linux. A developer on macOS/Windows should use the npm package; their agent, when it actually executes, will run on Linux anyway. Dropping those targets means there is no platform-native code-signing (Gatekeeper / SmartScreen) to rely on — Sigstore is the single, uniform trust anchor across both channels.

---

## Signing Chain

Every release artifact is verified end-to-end. The chain below is what you can independently re-verify for any published tag, offline, without any network call back to Sigstore at verification time.

### Sigstore keyless (Linux binaries and SHA256SUMS manifest)

Every binary and the aggregate `SHA256SUMS` manifest are signed using [Sigstore keyless signing](https://docs.sigstore.dev/signing/quickstart/) via GitHub Actions OIDC. No long-lived signing keys exist — there is nothing to steal and nothing to rotate.

**What gets signed**

- `anima-linux-x64`, `anima-linux-arm64`
- `anima-linux-x64.sigstore.bundle`, `anima-linux-arm64.sigstore.bundle`
- `SHA256SUMS` (aggregate hash list for the release)
- `SHA256SUMS.sigstore.bundle`

**How the signature is generated**

1. GitHub Actions issues a short-lived OIDC token to our release workflow.
2. Cosign exchanges that token with the [Fulcio](https://docs.sigstore.dev/certificate_authority/overview/) certificate authority for an ephemeral X.509 cert bound to the workflow identity.
3. Cosign signs the artifact with the cert's private key (held in memory only).
4. The signature + cert chain is appended to the [Rekor](https://docs.sigstore.dev/logging/overview/) transparency log — a tamper-evident, append-only public ledger.
5. The `.sigstore.bundle` wraps signature + cert + Rekor entry into one self-contained file.

**How to verify (from an agent pipeline)**

```bash
cosign verify-blob \
  --bundle anima-linux-x64.sigstore.bundle \
  --certificate-identity-regexp 'https://github.com/anima-labs-ai/cli/\.github/workflows/release\.yml@refs/tags/v.+' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  anima-linux-x64
```

The `--certificate-identity-regexp` is the critical part. It requires the Fulcio cert's subject to match our release workflow at a release tag. A cert issued to a *different* repo or workflow — even one signing the exact same binary bytes — will be rejected.

The `curl | sh` installer at <https://get.useanima.sh> performs this verification before executing any downloaded binary. It aborts with no fallback on any verification failure — a degraded install is worse than a failed one, because a failed install is visible and a degraded one isn't.

### Supply-chain provenance (npm)

The `@anima-labs/cli` npm package is published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). The provenance attestation links the published tarball to the exact commit and GitHub Actions workflow that built it. Verify from an agent pipeline with:

```bash
npm view @anima-labs/cli --json | jq .dist.attestations
```

or enforce it at install time (npm ≥ 9.5):

```bash
npm install --foreground-scripts=false @anima-labs/cli
npm audit signatures
```

### Optional: GPG detached signature

If `GPG_SIGNING_KEY` is provisioned in the release workflow, `SHA256SUMS.asc` is published alongside the Sigstore bundle. This exists for distros or downstream packagers that prefer a traditional PGP trust chain; it is redundant with Sigstore and is not the primary verification path.

---

## Threat Model

### In scope

- **Tampering of published artifacts (CDN, mirror, registry)**: mitigated by Sigstore signatures that are verifiable against a pinned workflow identity. A rogue mirror cannot substitute a binary — the Fulcio cert chain would not match.
- **Compromise of the release pipeline**: mitigated by (a) OIDC-only, no long-lived signing keys; (b) pinned action versions and pinned cosign version; (c) branch protection requiring review before a release tag can be pushed.
- **Credential exfiltration from the vault at rest**: mitigated by OS-keyring storage on the host where the CLI runs (libsecret inside Linux containers that mount the appropriate socket; environment-variable fallback otherwise). Secrets are never written to disk in plaintext.
- **Credential exfiltration over the daemon IPC**: mitigated by the sudo-style grace cache + peer-UID check on the 0o600 Unix socket. Only processes running as the same UID as the CLI can speak to the daemon.
- **Log/telemetry leaks**: mitigated by the strip-by-default scrubber — resolved secret values are redacted from stdout/stderr of the running command. Opt-out (`--no-scrub`) is explicit and loud.

### Out of scope

- **Sandbox escape by the subprocess `anima vault exec` launches.** `vault exec` is a credential launcher, not a sandbox. If the invoked program is malicious, no CLI feature will contain it. Run your agent in a container if you need isolation — and you should.
- **Keyring compromise by a co-resident process on the same UID.** An attacker with code execution in your agent's container already has your secrets; `anima` cannot change that. Scope credentials tightly (short-lived tokens, Connect Links) so the blast radius is bounded.
- **LLM provider data handling.** When `anima` passes data to an LLM, the provider's policies apply. Review your provider's DPA separately.
- **Configuration files the user controls.** `~/.config/anima/config.json`, environment variables, and anything the user (or their agent) writes are outside the trust boundary.
- **MCP servers the user connects.** The MCP trust boundary is the user's decision; we audit our first-party MCP servers but make no guarantee about third-party ones.

---

## Verifying a Release from CI

A complete, paste-ready verification step for any agent CI pipeline:

```bash
#!/bin/sh
set -eu
VERSION="v0.5.0"
ARCH="$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')"
BIN="anima-linux-${ARCH}"
BASE="https://github.com/anima-labs-ai/cli/releases/download/${VERSION}"

# Install cosign (pin a version in production — unpinned installs are themselves a supply-chain risk)
curl -fsSL -o /usr/local/bin/cosign \
  https://github.com/sigstore/cosign/releases/download/v2.4.1/cosign-linux-amd64
chmod +x /usr/local/bin/cosign

# Download manifest + per-binary bundle + binary
curl -fsSL -O "${BASE}/SHA256SUMS"
curl -fsSL -O "${BASE}/SHA256SUMS.sigstore.bundle"
curl -fsSL -O "${BASE}/${BIN}"

# Verify manifest signature against pinned workflow identity
cosign verify-blob \
  --bundle SHA256SUMS.sigstore.bundle \
  --certificate-identity-regexp 'https://github.com/anima-labs-ai/cli/\.github/workflows/release\.yml@refs/tags/v.+' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  SHA256SUMS

# Verify binary hash against the now-trusted manifest
grep " ${BIN}\$" SHA256SUMS | sha256sum -c -

install -m 0755 "${BIN}" /usr/local/bin/anima
```

If any step fails, the pipeline aborts. There is no fallback path.

---

## Pinned Identities

When writing verification automation, always pin against these identities — not against ad-hoc patterns:

- **Fulcio cert identity regex**: `https://github.com/anima-labs-ai/cli/.github/workflows/release\.yml@refs/tags/v.+`
- **OIDC issuer**: `https://token.actions.githubusercontent.com`
- **Cosign version (installer pin)**: `v2.4.1`
- **npm package scope**: `@anima-labs/`
- **GPG publisher fingerprint** (optional, present when `SHA256SUMS.asc` is published): <https://useanima.sh/.well-known/gpg-key.asc>

If any of these values change, we will announce the rotation with at least 30 days notice via the [releases page](https://github.com/anima-labs-ai/cli/releases) and email to `security-updates@useanima.sh` subscribers.
