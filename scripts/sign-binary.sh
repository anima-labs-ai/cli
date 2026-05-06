#!/usr/bin/env bash
# Sign a `bun build --compile`-produced binary so subsequent runs of the
# *same* binary share a stable identity with macOS — Gatekeeper, the
# Keychain "Always Allow" memory, and notarization all hang off this.
#
# Two modes:
#   • Real Developer ID — set APPLE_DEVELOPER_ID (e.g., "Developer ID
#     Application: Anima Labs (TEAMID)") and we sign with hardened runtime
#     + secure timestamp. Required for distribution outside the App Store
#     and for CI builds where each release is a different binary.
#   • Ad-hoc — no env var, fall back to `codesign --sign -`. Stable per
#     binary's own SHA: same bytes get the same identity, so Keychain
#     access decisions stick across runs of *this exact build*. Cross-build
#     stability requires the Developer ID path.
#
# Both modes verify after signing and bail loudly on failure — the previous
# build script silently swallowed `codesign` errors with `|| true`, which
# meant unsigned binaries could ship without anyone noticing.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <binary-path>" >&2
  exit 64
fi

BIN="$1"

if [[ ! -f "$BIN" ]]; then
  echo "sign-binary: $BIN does not exist" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    # Strip any existing signature so re-signing is idempotent. Squelch
    # output but NOT errors — a hard failure here means the file isn't
    # writable, which is worth knowing.
    codesign --remove-signature "$BIN" 2>/dev/null || true

    if [[ -n "${APPLE_DEVELOPER_ID:-}" ]]; then
      echo "sign-binary: signing with Developer ID: $APPLE_DEVELOPER_ID"
      # --options runtime: enable hardened runtime (required by notarytool).
      # --timestamp: secure timestamp from Apple (required by notarytool).
      # No entitlements file: shell-out to /usr/bin/security doesn't need
      # any keychain entitlements — the calling subprocess (security) has
      # its own.
      codesign \
        --sign "$APPLE_DEVELOPER_ID" \
        --force \
        --options runtime \
        --timestamp \
        "$BIN"
    else
      echo "sign-binary: ad-hoc signing (set APPLE_DEVELOPER_ID for a real signature)"
      codesign --sign - --force "$BIN"
    fi

    # Verify — fails loud if signing didn't take.
    codesign --verify --strict --verbose=2 "$BIN" 2>&1 | sed 's/^/  /'

    # If the user set APPLE_NOTARY_PROFILE we kick off notarization too.
    # Profile is created via `xcrun notarytool store-credentials`.
    if [[ -n "${APPLE_NOTARY_PROFILE:-}" && -n "${APPLE_DEVELOPER_ID:-}" ]]; then
      echo "sign-binary: submitting to Apple notary service ($APPLE_NOTARY_PROFILE)"
      ZIP="${BIN}.zip"
      ditto -c -k --sequesterRsrc --keepParent "$BIN" "$ZIP"
      xcrun notarytool submit "$ZIP" \
        --keychain-profile "$APPLE_NOTARY_PROFILE" \
        --wait
      # Single-file binaries can't be stapled directly; the notary ticket
      # is fetched online by Gatekeeper on first launch. This is the same
      # behavior `gh`, `stripe`, etc. have — distribute the bare binary
      # plus optionally a signed-and-notarized .pkg if a tighter UX is
      # desired later.
      rm -f "$ZIP"
    fi
    ;;

  Linux|FreeBSD)
    # No platform-native code-signing equivalent. The libsecret backend
    # uses session-level (DBus) identity, not binary identity, so signing
    # isn't a prerequisite for keychain access UX.
    ;;

  MINGW*|CYGWIN*|MSYS*)
    # Windows Authenticode signing requires a code-signing cert which most
    # devs don't have locally. CI should call signtool.exe separately when
    # WINDOWS_PFX_PATH / WINDOWS_PFX_PASSWORD are configured. Skip in dev.
    if [[ -n "${WINDOWS_PFX_PATH:-}" && -n "${WINDOWS_PFX_PASSWORD:-}" ]]; then
      signtool sign \
        /f "$WINDOWS_PFX_PATH" \
        /p "$WINDOWS_PFX_PASSWORD" \
        /tr http://timestamp.digicert.com \
        /td sha256 \
        /fd sha256 \
        "$BIN"
    else
      echo "sign-binary: skipping (set WINDOWS_PFX_PATH + WINDOWS_PFX_PASSWORD to sign)"
    fi
    ;;

  *)
    echo "sign-binary: unknown platform $(uname -s); skipping" >&2
    ;;
esac
