# typed: false
# frozen_string_literal: true

# Anima CLI — Homebrew formula (Phase 3G G3.2)
#
# Canonical source lives in cli/scripts/install/anima.rb and is synced to
# anima-labs-ai/homebrew-anima/Formula/anima.rb by the release workflow
# (G3.4). Do NOT edit the tap copy by hand — it gets clobbered on the next
# tagged release.
#
# Install:
#   brew tap anima-labs-ai/anima
#   brew install anima
#
# On each release, G3.4's update step rewrites:
#   - version (the `v1.2.3` in `url`)
#   - every `sha256` (from the signed SHA256SUMS manifest)
# No other fields should ever need touching; platform URLs key off `version`.
#
# Why a custom tap and not homebrew-core?
#   1. homebrew-core requires a source build, not a pre-built binary — our
#      shipping artifact IS a pre-built Bun binary (static, ~45 MB).
#   2. Version cadence: we release weekly during build-out; homebrew-core's
#      review queue is multi-day.
#   3. When the product stabilizes we'll submit a homebrew-cask too (cask is
#      the right home for pre-built CLIs with OS-native signing).

class Anima < Formula
  desc "Identity & credentials infrastructure for AI agents"
  homepage "https://useanima.sh"
  version "0.0.0"  # @@VERSION@@ — rewritten by G3.4 workflow

  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/anima-labs-ai/cli/releases/download/v#{version}/anima-darwin-arm64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"  # @@SHA_DARWIN_ARM64@@
    end
    on_intel do
      url "https://github.com/anima-labs-ai/cli/releases/download/v#{version}/anima-darwin-x64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"  # @@SHA_DARWIN_X64@@
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/anima-labs-ai/cli/releases/download/v#{version}/anima-linux-arm64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"  # @@SHA_LINUX_ARM64@@
    end
    on_intel do
      url "https://github.com/anima-labs-ai/cli/releases/download/v#{version}/anima-linux-x64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"  # @@SHA_LINUX_X64@@
    end
  end

  def install
    # The downloaded asset IS the executable — rename it to `anima` and move
    # into the Cellar's bin. Homebrew symlinks into /opt/homebrew/bin (M-series)
    # or /usr/local/bin (Intel / Linuxbrew).
    binary = if OS.mac? && Hardware::CPU.arm?    then "anima-darwin-arm64"
             elsif OS.mac?                       then "anima-darwin-x64"
             elsif OS.linux? && Hardware::CPU.arm? then "anima-linux-arm64"
             else                                     "anima-linux-x64"
             end
    bin.install binary => "anima"
  end

  def caveats
    <<~EOS
      Anima uses an OS keyring for secret storage. On first run, you may be
      prompted to allow access:
        • macOS: Keychain Access permission dialog
        • Linux: libsecret (gnome-keyring / KWallet)

      Verify your install (Sigstore keyless):
        cosign verify-blob \\
          --bundle <(curl -fsSL "https://github.com/anima-labs-ai/cli/releases/download/v#{version}/anima-#{OS.kernel_name.downcase}-#{Hardware::CPU.arch}.sigstore.bundle") \\
          --certificate-identity-regexp 'https://github.com/anima-labs-ai/cli/.github/workflows/release\\.yml@refs/tags/v.+' \\
          --certificate-oidc-issuer https://token.actions.githubusercontent.com \\
          "#{bin}/anima"

      Docs:        https://docs.useanima.sh
      Issues:      https://github.com/anima-labs-ai/cli/issues
      Security:    https://github.com/anima-labs-ai/cli/security/policy
    EOS
  end

  test do
    # `anima --version` prints the version string and exits 0.
    assert_match(/\d+\.\d+\.\d+/, shell_output("#{bin}/anima --version"))
    # `anima vault --help` exercises the full command tree — if subcommand
    # registration is broken (Phase 3F regressed), this fails loudly.
    assert_match "Vault commands", shell_output("#{bin}/anima vault --help")
  end
end
