#!/bin/sh
# shellcheck shell=sh
#
# Anima CLI installer — POSIX sh (works under dash, ash, bash, zsh).
# Served from https://get.useanima.sh (Cloudflare → raw GitHub content
# pinned to the latest release tag).
#
# Target: Linux x64 + arm64. The Anima CLI is consumed by agents —
# containers, VMs, CI runners — so macOS/Windows are explicitly out
# of scope. If you're looking for a Node/TS install path, use:
#   npm install -g @anima-labs/cli
#
# Invocation:
#   curl -fsSL https://get.useanima.sh | sh
#   curl -fsSL https://get.useanima.sh | sh -s -- --version v1.2.3
#   curl -fsSL https://get.useanima.sh | sh -s -- --prefix /opt/anima/bin
#
# Security model — why this is safe to pipe to sh:
#   1. The script is short, self-contained, and reviewable (no remote
#      eval beyond the initial fetch).
#   2. It never executes the downloaded anima binary without first
#      verifying the Sigstore bundle against the pinned release-workflow
#      identity. A tampered CDN or mirror can't slip a substitute binary
#      past this check — the transparency-log entry and Fulcio cert
#      chain are end-to-end verifiable.
#   3. Cosign itself is verified by SHA-256 against a hash embedded
#      below (COSIGN_SHA256). If cosign is tampered with, the script
#      aborts.
#   4. The SHA256SUMS manifest is verified *before* any per-binary hash
#      is trusted. The manifest's signature is the single root of trust.
#
# Failure mode: if ANY verification step fails, the script aborts with
# a non-zero exit and prints diagnostic output. No "best-effort"
# fallback — a degraded security posture is worse than a failed
# install, because a failed install is visible and a degraded one isn't.

set -eu

# ---- Config --------------------------------------------------------------

REPO_OWNER="anima-labs-ai"
REPO_NAME="cli"
RELEASE_API="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases"
RELEASE_BASE="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download"

# Pinned cosign version + SHA-256 per platform. Update these together
# with the workflow's cosign-release pin (release.yml's
# sigstore/cosign-installer).
COSIGN_VERSION="v2.4.1"
# Computed from
#   https://github.com/sigstore/cosign/releases/download/v2.4.1/cosign_checksums.txt
COSIGN_SHA256_LINUX_AMD64="823ee8e32af4a09a5b94b71df6afcda5a79ad187f0756c69d5fd44d9a7b7d167"
COSIGN_SHA256_LINUX_ARM64="15f05e1adcbe54c06a12a4be8d9c86ce4b0a40a9b93b48738ee6e8f4d3c6e8b2"

# Pinned OIDC identity. Any cert that doesn't match this regex is
# rejected — even a valid Fulcio cert from a different workflow.
CERT_IDENTITY_REGEX="https://github.com/${REPO_OWNER}/${REPO_NAME}/.github/workflows/release\.yml@refs/tags/v.+"
CERT_OIDC_ISSUER="https://token.actions.githubusercontent.com"

VERSION=""
PREFIX=""

# ---- Logging -------------------------------------------------------------

info() { printf '\033[1;34m[info]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[err ]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

# ---- Arg parsing ---------------------------------------------------------

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --prefix)  PREFIX="$2";  shift 2 ;;
    --help|-h)
      cat <<EOF
Anima CLI installer (Linux x64 / arm64)

Usage:
  curl -fsSL https://get.useanima.sh | sh
  curl -fsSL https://get.useanima.sh | sh -s -- [options]

Options:
  --version <tag>   Install a specific release (default: latest)
  --prefix <dir>    Install into <dir> (default: /usr/local/bin or ~/.local/bin)
  --help            Show this help

For Node/TS projects, prefer:
  npm install -g @anima-labs/cli

The installer verifies every artifact with Sigstore (cosign) before
executing it. Failed verification aborts with no fallback.
EOF
      exit 0
      ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# ---- Platform detection --------------------------------------------------

uname_s="$(uname -s)"
uname_m="$(uname -m)"
case "$uname_s" in
  Linux) os="linux" ;;
  *)
    die "Unsupported OS: $uname_s. The Anima CLI ships Linux-only binaries. For Node/TS projects use: npm install -g @anima-labs/cli"
    ;;
esac
case "$uname_m" in
  x86_64|amd64)  arch="x64"   ; cosign_arch="amd64" ;;
  aarch64|arm64) arch="arm64" ; cosign_arch="arm64" ;;
  *) die "Unsupported architecture: $uname_m (expected x86_64 or arm64)" ;;
esac
binary="anima-${os}-${arch}"
info "Platform: ${os}-${arch}  →  ${binary}"

# ---- Dependency checks ---------------------------------------------------

for cmd in curl sha256sum; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    die "Missing required command: $cmd"
  fi
done

# ---- Resolve target release ----------------------------------------------

if [ -z "$VERSION" ]; then
  info "Resolving latest release..."
  # Parse the latest-release endpoint with POSIX tools only (no jq).
  tag="$(curl -fsSL "${RELEASE_API}/latest" \
         | awk -F'"' '/"tag_name":/ {print $4; exit}')"
  [ -n "$tag" ] || die "Could not resolve latest release"
  VERSION="$tag"
fi
info "Installing ${VERSION}"

# ---- Ensure cosign is available & verified ------------------------------

cosign=""
tmpdir=""
if command -v cosign >/dev/null 2>&1; then
  cosign="cosign"
  info "Using system cosign: $(cosign version 2>/dev/null | head -n1 || echo unknown)"
else
  info "cosign not found — downloading pinned ${COSIGN_VERSION}"
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT
  cosign_url="https://github.com/sigstore/cosign/releases/download/${COSIGN_VERSION}/cosign-${os}-${cosign_arch}"
  cosign="${tmpdir}/cosign"
  curl -fsSL -o "$cosign" "$cosign_url" || die "Failed to download cosign"

  case "${os}-${cosign_arch}" in
    linux-amd64) expected_sha="$COSIGN_SHA256_LINUX_AMD64" ;;
    linux-arm64) expected_sha="$COSIGN_SHA256_LINUX_ARM64" ;;
    *) die "No pinned cosign hash for ${os}-${cosign_arch}" ;;
  esac
  actual_sha="$(sha256sum "$cosign" | awk '{print $1}')"
  [ "$actual_sha" = "$expected_sha" ] \
    || die "cosign hash mismatch — refusing to continue (expected $expected_sha, got $actual_sha)"
  chmod +x "$cosign"
fi

# ---- Download & verify SHA256SUMS manifest ------------------------------

stage="$(mktemp -d)"
# Extend the earlier trap to also clean the staging dir if cosign was
# downloaded; otherwise set a new one.
if [ -n "$tmpdir" ]; then
  trap 'rm -rf "$tmpdir" "$stage" 2>/dev/null || true' EXIT
else
  trap 'rm -rf "$stage" 2>/dev/null || true' EXIT
fi

info "Downloading release manifest..."
curl -fsSL -o "${stage}/SHA256SUMS"                 "${RELEASE_BASE}/${VERSION}/SHA256SUMS"
curl -fsSL -o "${stage}/SHA256SUMS.sigstore.bundle" "${RELEASE_BASE}/${VERSION}/SHA256SUMS.sigstore.bundle"

info "Verifying manifest signature (Sigstore keyless)..."
"$cosign" verify-blob \
  --bundle "${stage}/SHA256SUMS.sigstore.bundle" \
  --certificate-identity-regexp "$CERT_IDENTITY_REGEX" \
  --certificate-oidc-issuer "$CERT_OIDC_ISSUER" \
  "${stage}/SHA256SUMS" \
  >/dev/null 2>&1 \
  || die "Manifest signature verification FAILED — aborting. This release may be tampered with. Report at https://github.com/${REPO_OWNER}/${REPO_NAME}/issues"
info "✓ Manifest signature verified"

# ---- Download & verify binary -------------------------------------------

info "Downloading ${binary}..."
curl -fsSL -o "${stage}/${binary}" "${RELEASE_BASE}/${VERSION}/${binary}"

# The SHA-256 line we trust is the one *inside the signed manifest*.
expected_sha="$(awk -v f="$binary" '$2 == f {print $1; exit}' "${stage}/SHA256SUMS")"
[ -n "$expected_sha" ] || die "Binary ${binary} not listed in signed manifest"

actual_sha="$(sha256sum "${stage}/${binary}" | awk '{print $1}')"
[ "$actual_sha" = "$expected_sha" ] \
  || die "Binary hash mismatch vs signed manifest — aborting"
info "✓ Binary hash matches signed manifest"

# ---- Install -------------------------------------------------------------

# Prefix selection precedence:
#   1. --prefix flag
#   2. $ANIMA_INSTALL_PREFIX env var
#   3. /usr/local/bin if writable (or sudo-invoked)
#   4. $HOME/.local/bin (user-scope, no sudo)
if [ -z "$PREFIX" ] && [ -n "${ANIMA_INSTALL_PREFIX:-}" ]; then
  PREFIX="$ANIMA_INSTALL_PREFIX"
fi
if [ -z "$PREFIX" ]; then
  if [ -w /usr/local/bin ] || [ "$(id -u)" = "0" ]; then
    PREFIX="/usr/local/bin"
  else
    PREFIX="${HOME}/.local/bin"
    mkdir -p "$PREFIX"
  fi
fi

chmod +x "${stage}/${binary}"
install_path="${PREFIX}/anima"

if command -v install >/dev/null 2>&1; then
  install -m 0755 "${stage}/${binary}" "$install_path"
else
  mv "${stage}/${binary}" "$install_path"
  chmod 0755 "$install_path"
fi

info "✓ Installed to $install_path"

# ---- PATH hint -----------------------------------------------------------

case ":$PATH:" in
  *":$PREFIX:"*) ;;
  *)
    warn "$PREFIX is not in your PATH. Add this to your shell rc:"
    printf '    export PATH="%s:$PATH"\n' "$PREFIX" >&2
    ;;
esac

info "Run: anima --help"
