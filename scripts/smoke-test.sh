#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "${haystack}" != *"${needle}"* ]]; then
    echo "Expected output to contain: ${needle}" >&2
    exit 1
  fi
}

echo "[smoke] packing local CLI package"
(cd "${CLI_DIR}" && bun pm pack --destination "${WORK_DIR}") >/dev/null

shopt -s nullglob
TARBALLS=("${WORK_DIR}"/*.tgz)
shopt -u nullglob

if [[ ${#TARBALLS[@]} -eq 0 ]]; then
  echo "Failed to produce package tarball in ${WORK_DIR}" >&2
  exit 1
fi

PACKAGE_TARBALL="${TARBALLS[0]}"

if [[ ! -f "${PACKAGE_TARBALL}" ]]; then
  echo "Failed to produce package tarball at ${PACKAGE_TARBALL}" >&2
  exit 1
fi

echo "[smoke] installing package in isolated temp workspace"
mkdir -p "${WORK_DIR}/sandbox"
cat >"${WORK_DIR}/sandbox/package.json" <<'JSON'
{
  "name": "anima-cli-smoke",
  "version": "0.0.0",
  "private": true
}
JSON
(cd "${WORK_DIR}/sandbox" && bun add "${PACKAGE_TARBALL}") >/dev/null

echo "[smoke] validating am --version"
VERSION_OUTPUT="$(cd "${WORK_DIR}/sandbox" && bun x --bun am --version)"
assert_contains "${VERSION_OUTPUT}" "0.1.0"

echo "[smoke] validating am --help"
HELP_OUTPUT="$(cd "${WORK_DIR}/sandbox" && bun x --bun am --help)"
assert_contains "${HELP_OUTPUT}" "Anima CLI"
assert_contains "${HELP_OUTPUT}" "auth"

echo "[smoke] validating am auth --help"
AUTH_HELP_OUTPUT="$(cd "${WORK_DIR}/sandbox" && bun x --bun am auth --help)"
assert_contains "${AUTH_HELP_OUTPUT}" "Authentication and session management"

echo "[smoke] OK"
