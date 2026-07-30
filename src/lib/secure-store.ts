/**
 * Cross-platform secure credential storage for the Anima CLI.
 *
 * Why this exists: prior versions wrote `apiKey`/`refreshToken` to a plaintext
 * `auth.json` in the OS config dir. Anything running as the user (a malicious
 * postinstall, a leaked dev tool, Time Machine, an iCloud Drive sync) could
 * exfiltrate a 30-day refresh token. This module moves secrets into the
 * platform's native credential store while leaving non-secret metadata
 * (apiUrl, email, expiry timestamps) in the file.
 *
 * Backends shell out to the OS-native credential CLI rather than linking a
 * NAPI native module. Reasons:
 *   • Works with `bun build --compile` standalone binaries (no .node bundling)
 *   • The calling process is the OS-blessed system tool, which has its own
 *     keychain identity — important for unsigned bun-compiled binaries that
 *     would otherwise trigger a fresh "allow access?" prompt on every run.
 *   • Zero runtime supply-chain surface beyond what's already on the OS.
 *
 * Backend per platform:
 *   macOS   → `security add/find/delete-generic-password`
 *   Linux   → `secret-tool store/lookup/clear` (libsecret / Secret Service)
 *   Windows → PowerShell + System.Security.Cryptography.ProtectedData (DPAPI),
 *             encrypted blob written to a sibling file under the config dir
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/** Service identifier used as the keychain `-s` value. Reverse-DNS form. */
export const SERVICE_NAME = 'sh.useanima.cli';

/**
 * Single account name used today. Kept as a parameter so we can later
 * key by apiUrl (dev / staging / prod) without breaking the wire format.
 */
export const DEFAULT_ACCOUNT = 'default';

export interface SecureStore {
  /** Returns null if no entry exists. Throws on backend failure. */
  getSecret(account: string): Promise<string | null>;
  setSecret(account: string, secret: string): Promise<void>;
  /** Idempotent — succeeds whether or not an entry existed. */
  deleteSecret(account: string): Promise<void>;
  /** Human-readable backend name surfaced in error messages. */
  readonly name: string;
  /**
   * Whether this backend can make the OS refuse to release a secret until a
   * human proves they are present.
   *
   * This is the difference between encryption at rest and an actual gate. Every
   * backend here encrypts; only macOS can stop a process running as the user —
   * an agent driving the CLI, say — from reading a secret back without a person
   * answering a system dialog. Callers branch on this rather than on
   * `process.platform`, so the fallback path is chosen by capability.
   */
  readonly humanPresenceGate: boolean;
  /**
   * Store a secret the OS will not hand back without a human present.
   *
   * Throws {@link SecureStoreUnavailableError} when `humanPresenceGate` is
   * false: silently degrading to an ordinary write would leave the caller
   * believing a gate exists where none does, which is the one failure mode
   * this whole mechanism cannot afford.
   */
  setGatedSecret(account: string, secret: string): Promise<void>;
}

export class SecureStoreUnavailableError extends Error {
  constructor(
    public readonly platform: NodeJS.Platform,
    public readonly reason: string,
    public readonly hint?: string,
  ) {
    super(
      hint
        ? `Secure credential storage unavailable on ${platform}: ${reason}\n${hint}`
        : `Secure credential storage unavailable on ${platform}: ${reason}`,
    );
    this.name = 'SecureStoreUnavailableError';
  }
}

// ── macOS ───────────────────────────────────────────────────────────────────

class MacOSKeychainStore implements SecureStore {
  readonly name = 'macOS Keychain';

  async getSecret(account: string): Promise<string | null> {
    const r = spawnSync(
      'security',
      ['find-generic-password', '-s', SERVICE_NAME, '-a', account, '-w'],
      { encoding: 'utf8' },
    );
    // Exit 44 is `errSecItemNotFound` — entry simply doesn't exist yet.
    if (r.status === 44) return null;
    if (r.status === 0) return r.stdout.replace(/\r?\n$/, '');
    throw new Error(
      `security find-generic-password failed (status ${r.status}): ${r.stderr.trim()}`,
    );
  }

  async setSecret(account: string, secret: string): Promise<void> {
    // `-U` updates if an entry with this (service, account) exists, else creates.
    // Caveat: passing the secret as `-w <value>` makes it visible to other
    // processes of this user via `ps` for the duration of the call. macOS
    // restricts non-root users to seeing only their own processes, and the
    // window is microseconds; same trade-off `gh`/`stripe`/`vercel` make.
    const r = spawnSync(
      'security',
      [
        'add-generic-password',
        '-s', SERVICE_NAME,
        '-a', account,
        '-U',
        '-w', secret,
      ],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) {
      throw new Error(
        `security add-generic-password failed (status ${r.status}): ${r.stderr.trim()}`,
      );
    }
  }

  async deleteSecret(account: string): Promise<void> {
    // Suppress error if entry doesn't exist — deletion is idempotent.
    spawnSync(
      'security',
      ['delete-generic-password', '-s', SERVICE_NAME, '-a', account],
      { encoding: 'utf8' },
    );
  }

  readonly humanPresenceGate = true;

  async setGatedSecret(account: string, secret: string): Promise<void> {
    // Delete-then-add rather than `-U`. Updating in place is itself an
    // authorised read of the existing item, so `-U` against an already-gated
    // entry raises the very prompt this is trying to arm — measured, not
    // assumed: `add -U` on a gated item blocks, while `delete` returns
    // immediately because removing an item is not a read of its secret.
    await this.deleteSecret(account);

    const r = spawnSync(
      'security',
      [
        'add-generic-password',
        '-s', SERVICE_NAME,
        '-a', account,
        '-w', secret,
        // An empty trusted-application list. Without it the creating program
        // is added to the ACL and reads straight back with no prompt, which is
        // how every other entry this module writes behaves. With it, no
        // program — `security` included — can read the secret until the OS has
        // asked a human for the login password.
        '-T', '',
      ],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) {
      throw new Error(
        `security add-generic-password (gated) failed (status ${r.status}): ${r.stderr.trim()}`,
      );
    }
  }
}

// ── Linux ───────────────────────────────────────────────────────────────────

class LinuxSecretToolStore implements SecureStore {
  readonly name = 'libsecret (Secret Service)';

  async getSecret(account: string): Promise<string | null> {
    const r = spawnSync(
      'secret-tool',
      ['lookup', 'service', SERVICE_NAME, 'account', account],
      { encoding: 'utf8' },
    );
    // secret-tool exits 1 with empty stdout when the entry is missing.
    if (r.status === 0 && r.stdout.length > 0) return r.stdout;
    if (r.status === 1 && r.stdout.length === 0) return null;
    throw new Error(
      `secret-tool lookup failed (status ${r.status}): ${r.stderr.trim()}`,
    );
  }

  async setSecret(account: string, secret: string): Promise<void> {
    // secret-tool reads the secret from stdin — no `ps` exposure.
    const r = spawnSync(
      'secret-tool',
      [
        'store',
        '--label=Anima CLI credentials',
        'service', SERVICE_NAME,
        'account', account,
      ],
      { input: secret, encoding: 'utf8' },
    );
    if (r.status !== 0) {
      throw new Error(
        `secret-tool store failed (status ${r.status}): ${r.stderr.trim()}`,
      );
    }
  }

  async deleteSecret(account: string): Promise<void> {
    spawnSync(
      'secret-tool',
      ['clear', 'service', SERVICE_NAME, 'account', account],
      { encoding: 'utf8' },
    );
  }

  readonly humanPresenceGate = false;

  async setGatedSecret(): Promise<void> {
    noHumanPresenceGate('linux', this.name);
  }
}

/**
 * Shared refusal for backends that encrypt at rest but cannot gate a read.
 *
 * One function rather than a message per backend, because the distinction that
 * matters is identical in both cases and must not drift: the secret is safe on
 * disk, and completely available to anything already running as this user.
 */
function noHumanPresenceGate(platform: NodeJS.Platform, backend: string): never {
  throw new SecureStoreUnavailableError(
    platform,
    `${backend} encrypts secrets at rest, but cannot require a human to be present before releasing one.`,
    'Storing an owner grant here would look protected while being readable by anything running as you. ' +
      'Use `am auth elevate` with the emailed code on this platform instead.',
  );
}

function ensureSecretToolAvailable(): void {
  const r = spawnSync('which', ['secret-tool'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim().length > 0) return;
  throw new SecureStoreUnavailableError(
    'linux',
    'the `secret-tool` binary (libsecret) is not installed.',
    'Install it: `sudo apt install libsecret-tools` (Debian/Ubuntu) or `sudo dnf install libsecret` (Fedora). ' +
      'In headless / CI environments, prefer setting the ANIMA_API_KEY environment variable.',
  );
}

// ── Windows ─────────────────────────────────────────────────────────────────
//
// Strategy: encrypt the secret blob via DPAPI under the user's profile,
// write the resulting ciphertext as a separate file next to auth.json. Only
// this user on this machine can decrypt it (CurrentUser scope). Windows
// Credential Manager would be marginally cleaner but its programmatic API
// is ugly via PowerShell, while DPAPI is one-liner from .NET.

class WindowsDpapiStore implements SecureStore {
  readonly name = 'Windows DPAPI (CurrentUser)';

  constructor(private readonly secretsFilePath: (account: string) => string) {}

  async getSecret(account: string): Promise<string | null> {
    const path = this.secretsFilePath(account);
    if (!existsSync(path)) return null;
    const ciphertext = readFileSync(path, 'utf8').trim();
    const r = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$bytes=[Convert]::FromBase64String($input);' +
          '$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,' +
          '[System.Security.Cryptography.DataProtectionScope]::CurrentUser);' +
          '[System.Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain))',
      ],
      { input: ciphertext, encoding: 'utf8' },
    );
    if (r.status !== 0) {
      throw new Error(`DPAPI Unprotect failed: ${r.stderr.trim()}`);
    }
    return r.stdout;
  }

  async setSecret(account: string, secret: string): Promise<void> {
    const r = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$plain=[System.Text.Encoding]::UTF8.GetBytes($input);' +
          '$enc=[System.Security.Cryptography.ProtectedData]::Protect($plain,$null,' +
          '[System.Security.Cryptography.DataProtectionScope]::CurrentUser);' +
          '[System.Console]::Out.Write([Convert]::ToBase64String($enc))',
      ],
      { input: secret, encoding: 'utf8' },
    );
    if (r.status !== 0) {
      throw new Error(`DPAPI Protect failed: ${r.stderr.trim()}`);
    }
    const path = this.secretsFilePath(account);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, r.stdout, { mode: 0o600 });
  }

  async deleteSecret(account: string): Promise<void> {
    const path = this.secretsFilePath(account);
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // file may already be gone — idempotent
      }
    }
  }

  readonly humanPresenceGate = false;

  async setGatedSecret(): Promise<void> {
    // DPAPI CurrentUser decrypts for any process running as this user, with no
    // prompt. Windows Hello could gate it, but not through this backend.
    noHumanPresenceGate('win32', this.name);
  }
}

// ── Memory backend (tests + bypass for `--no-keychain` future flag) ─────────

export class InMemorySecureStore implements SecureStore {
  readonly name = 'in-memory (test)';
  private readonly entries = new Map<string, string>();

  /**
   * Which accounts were written through {@link setGatedSecret}.
   *
   * Exposed because "was this stored behind a gate?" is the one property tests
   * of the grant flow actually need to assert, and it is invisible in the
   * stored value. A test that only checked the secret round-trips would pass
   * just as happily against an ungated write.
   */
  readonly gatedAccounts = new Set<string>();

  /** Settable so a test can exercise the no-gate fallback path. */
  humanPresenceGate = true;

  async getSecret(account: string): Promise<string | null> {
    return this.entries.get(account) ?? null;
  }

  async setSecret(account: string, secret: string): Promise<void> {
    this.entries.set(account, secret);
    // An ordinary write over a gated account clears the gate, mirroring the
    // real backend, where `add-generic-password` without `-T ''` re-admits the
    // creating program to the ACL.
    this.gatedAccounts.delete(account);
  }

  async deleteSecret(account: string): Promise<void> {
    this.entries.delete(account);
    this.gatedAccounts.delete(account);
  }

  async setGatedSecret(account: string, secret: string): Promise<void> {
    if (!this.humanPresenceGate) noHumanPresenceGate('linux', this.name);
    this.entries.set(account, secret);
    this.gatedAccounts.add(account);
  }
}

// ── Selection / DI ──────────────────────────────────────────────────────────

let _store: SecureStore | null = null;
let _override: SecureStore | null = null;

/** Test hook — replaces the platform-detected backend with an injected one. */
export function setSecureStoreOverride(store: SecureStore | null): void {
  _override = store;
  _store = null;
}

export function resetSecureStoreCache(): void {
  _store = null;
}

/**
 * Resolves the platform backend. The Windows backend needs to know where to
 * write its encrypted-blob sidecar file, which is owned by `config.ts`; we
 * inject that lazily via the `secretsFilePath` argument.
 */
export function getSecureStore(secretsFilePath?: (account: string) => string): SecureStore {
  if (_override) return _override;
  if (_store) return _store;

  if (process.platform === 'darwin') {
    _store = new MacOSKeychainStore();
  } else if (process.platform === 'linux') {
    ensureSecretToolAvailable();
    _store = new LinuxSecretToolStore();
  } else if (process.platform === 'win32') {
    if (!secretsFilePath) {
      throw new Error(
        'Windows backend requires a secretsFilePath resolver. This is a bug — ' +
          'config.ts must pass the resolver on first call.',
      );
    }
    _store = new WindowsDpapiStore(secretsFilePath);
  } else {
    throw new SecureStoreUnavailableError(
      process.platform,
      'no secure-storage backend is implemented for this platform.',
      'Set the ANIMA_API_KEY environment variable to bypass storage entirely.',
    );
  }
  return _store;
}
