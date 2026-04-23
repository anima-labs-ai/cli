# Security

This document describes the Anima CLI's security model, the signing chain for released binaries, and how to report a vulnerability. It is intended as a procurement-ready reference — if you need to satisfy an enterprise security review before adopting `anima`, the answers below are the same ones we'd give in a vendor questionnaire.

## Reporting a Vulnerability

Please report security issues privately via GitHub Security Advisories: <https://github.com/anima-labs-ai/cli/security/advisories/new>.

If you do not receive an acknowledgement within 2 business days, escalate to **security@useanima.sh** (PGP key: [useanima.sh/.well-known/gpg-key.asc](https://useanima.sh/.well-known/gpg-key.asc)).

We run a public bug bounty for the CLI and the Vault — scope, rewards, and safe-harbor terms are at <https://useanima.sh/security/bounty>.

We **do not accept AI-generated reports without a human-verified proof-of-concept**. Automated scanner output pasted verbatim will be closed without comment.

---

## Signing Chain

Every release artifact is verified end-to-end. The chain below is what you can independently re-verify for any published tag.

### Primary: Sigstore keyless (all platforms)

Every binary and the aggregate `SHA256SUMS` manifest are signed using [Sigstore keyless signing](https://docs.sigstore.dev/signing/quickstart/) via GitHub Actions OIDC. No long-lived signing keys exist — there is nothing to steal and nothing to rotate.

**What gets signed**

- `anima-<os>-<arch>` (one per target: 5 binaries)
- `anima-<os>-<arch>.sigstore.bundle` sits alongside each
- `SHA256SUMS` manifest (aggregate hash list)
- `SHA256SUMS.sigstore.bundle` sits alongside

**How the signature is generated**

1. GitHub Actions issues a short-lived OIDC token to our release workflow.
2. Cosign exchanges that token with the [Fulcio](https://docs.sigstore.dev/certificate_authority/overview/) certificate authority for an ephemeral X.509 cert bound to the workflow identity.
3. Cosign signs the artifact with the cert's private key (held in memory only).
4. The signature + cert chain is appended to the [Rekor](https://docs.sigstore.dev/logging/overview/) transparency log — a tamper-evident, append-only public ledger.
5. The `.sigstore.bundle` wraps signature + cert + Rekor entry into one self-contained file.

**How to verify**

```bash
cosign verify-blob \
  --bundle anima-linux-x64.sigstore.bundle \
  --certificate-identity-regexp 'https://github.com/anima-labs-ai/cli/\.github/workflows/release\.yml@refs/tags/v.+' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  anima-linux-x64
```

The `--certificate-identity-regexp` is the critical part. It requires the Fulcio cert's subject to match our release workflow at a release tag. A cert issued to a *different* repo or workflow — even one for the same binary bytes — will be rejected.

### Platform-native signatures

On top of Sigstore, platform-native signatures satisfy OS gatekeepers:

| Platform  | Signature                                               | Status                                  |
|-----------|---------------------------------------------------------|-----------------------------------------|
| macOS     | Developer ID Application code signature + notarization  | Scaffolding in place; enrollment pending |
| Windows   | Authenticode via signtool                               | Scaffolding in place; EV cert procurement pending |
| Linux     | GPG-signed `SHA256SUMS.asc` (Debian/RPM pipelines)      | Available when the publisher key is provisioned |

The release workflow gates each of these on the presence of the corresponding secret. Until enrollment completes, Sigstore is the binding cryptographic check on all platforms. The macOS / Windows OS gatekeepers will show their usual unsigned-binary UX in the interim; use the Sigstore verification above as the authoritative check.

### Supply-chain provenance (npm track)

The `@anima-labs/cli` npm package is published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). The provenance attestation links the published tarball to the exact commit and GitHub Actions workflow that built it. Verify with:

```bash
npm view @anima-labs/cli --json | jq .dist.attestations
```

---

## Threat Model

### In scope

- **Tampering of published artifacts**: mitigated by Sigstore + platform-native signatures + transparency-log append.
- **Compromise of the release pipeline**: mitigated by (a) OIDC-only, no long-lived signing keys; (b) pinned action versions (G3.4); (c) branch protection requiring review before a release tag can be pushed.
- **Credential exfiltration from the vault at rest**: mitigated by OS-keyring storage (Keychain / Credential Manager / libsecret) — secrets are never written to disk in plaintext, even when the CLI process is killed.
- **Credential exfiltration over the daemon IPC**: mitigated by the Phase 3F HYBRID authz model — sudo-style grace cache + OS-native confirmation dialog for sensitive operations (e.g. `type`), 0o600 Unix-socket peer-UID check for the daemon endpoint.
- **Log/telemetry leaks**: mitigated by the Phase 3F strip-by-default scrubber — resolved secret values are redacted from stdout/stderr of the running command, with opt-out (`--no-scrub`) explicit and loud.

### Out of scope

- **Sandbox escape by the subprocess `anima vault exec` launches.** `vault exec` is a credential launcher, not a sandbox. If the invoked program is malicious, no CLI feature will contain it. Run in a container if you need isolation.
- **Keyring compromise by a co-resident process on the same UID.** Keychain/Credential Manager/libsecret trust the user's session. An attacker with code execution in your shell already has your secrets; `anima` cannot change that.
- **LLM provider data handling.** When `anima` passes data to an LLM, the provider's policies apply. Review your provider's DPA separately.
- **Configuration files the user controls.** `~/.config/anima/config.json`, shell rc files, and anything the user writes are outside the trust boundary.
- **MCP servers the user connects.** The MCP trust boundary is the user's decision; we audit our first-party MCP servers but make no guarantee about third-party ones.

---

## Enterprise Procurement

Common vendor-security-review answers in one place:

| Question | Answer |
|---|---|
| Is the CLI open source? | Yes, Apache-2.0. Source at <https://github.com/anima-labs-ai/cli>. |
| How are binaries signed? | Sigstore keyless (all platforms) + macOS Developer ID + Windows Authenticode + GPG SHA256SUMS.asc. See above for verification commands. |
| Can we verify provenance offline? | Yes. `.sigstore.bundle` files are self-contained; `cosign verify-blob --bundle` needs no network access. |
| Is there a transparency log? | Yes — public Rekor log (<https://rekor.sigstore.dev>). Every release signature is auditable by tag. |
| Where are credentials stored? | OS-native keyring only (Keychain, Credential Manager, libsecret). Never on disk in plaintext. |
| Does it send telemetry? | Off by default. If enabled, only anonymized command names + exit codes; never arguments, env vars, or credentials. Full schema at <https://useanima.sh/telemetry>. |
| Is there SBOM support? | Yes. Each release publishes CycloneDX + SPDX SBOMs as release assets. |
| SOC 2 / ISO 27001? | SOC 2 Type II audit in progress, expected Q3 2026. Interim: platform runs on SOC 2 / ISO 27001-certified infra (AWS, Cloudflare). |
| Where does the CLI fetch updates? | Nowhere — the CLI does not self-update. Updates are user-initiated via Homebrew/Winget/npm/curl installer. |
| Air-gapped install supported? | Yes. Download the binary + `.sigstore.bundle` on a connected host, verify, then transfer. No network calls at runtime unless the user invokes an API command. |

For security-review calls, reach out to **security@useanima.sh** — typical turnaround is 1–2 business days.

---

## Pinned Identities

When writing verification scripts, always pin against these identities — not against ad-hoc patterns:

- **Fulcio cert identity regex**: `https://github.com/anima-labs-ai/cli/.github/workflows/release\.yml@refs/tags/v.+`
- **OIDC issuer**: `https://token.actions.githubusercontent.com`
- **GPG publisher fingerprint**: published at <https://useanima.sh/.well-known/gpg-key.asc>
- **npm package scope**: `@anima-labs/`

If these values ever change, we will announce the rotation with at least 30 days notice via the [releases page](https://github.com/anima-labs-ai/cli/releases) and email to `security-updates@useanima.sh` subscribers.
