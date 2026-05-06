import envPaths from 'env-paths';
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_ACCOUNT,
  getSecureStore,
  InMemorySecureStore,
  setSecureStoreOverride,
  type SecureStore,
} from './secure-store.js';

let _paths: ReturnType<typeof envPaths> | null = null;
let _pathsOverride: ReturnType<typeof envPaths> | null = null;

function getPaths(): ReturnType<typeof envPaths> {
  if (_pathsOverride) return _pathsOverride;
  if (!_paths) {
    _paths = envPaths('anima', { suffix: '' });
  }
  return _paths;
}

export function resetPathsCache(): void {
  _paths = null;
  _pathsOverride = null;
  // Also clear the implicit in-memory keychain that setPathsOverride installs
  // for tests — otherwise leftover credentials could leak between specs.
  setSecureStoreOverride(null);
}

/**
 * Installing a paths override is the canonical signal that we're inside a
 * test (or a sandboxed scenario that needs isolation). Without this, every
 * test that calls saveAuthConfig would write to the real OS keychain and
 * leak `default` credentials across specs and onto the developer's machine.
 *
 * If a test explicitly wants a different secure store (e.g., to assert the
 * stored blob format), it can call `setSecureStoreOverride` afterward to
 * replace the auto-installed one.
 */
export function setPathsOverride(paths: ReturnType<typeof envPaths>): void {
  _pathsOverride = paths;
  setSecureStoreOverride(new InMemorySecureStore());
}

export interface AuthConfig {
  token?: string;
  refreshToken?: string;
  /**
   * ISO-8601 expiry of `token` (session-token flow) OR `apiKey` when the
   * apiKey field holds an OAuth access token (`oat_*` prefix). Used for
   * proactive auto-refresh — see `ensureFreshOAuthToken` in `auth.ts`.
   */
  expiresAt?: string;
  /**
   * ISO-8601 expiry of `refreshToken`. Set on OAuth login; lets the CLI
   * give a clean "your session expired, please log in again" message
   * without needing a network round-trip when the RT itself is dead.
   * Optional for back-compat with auth.json files written by older CLIs.
   */
  refreshTokenExpiresAt?: string;
  apiKey?: string;
  apiUrl?: string;
  email?: string;
}

export interface AppConfig {
  defaultOrg?: string;
  defaultIdentity?: string;
  outputFormat?: 'table' | 'json' | 'yaml';
  activeProfile?: string;
  profiles?: Record<string, ProfileConfig>;
}

export interface ProfileConfig {
  apiUrl?: string;
  apiKey?: string;
  defaultOrg?: string;
  defaultIdentity?: string;
  outputFormat?: 'table' | 'json' | 'yaml';
}

/**
 * Layered config resolution: flags > env > profile > defaults
 */
export async function resolveConfigValue(key: keyof ProfileConfig, flagValue?: string): Promise<string | undefined> {
  // 1. CLI flag (highest priority)
  if (flagValue !== undefined && flagValue !== '') return flagValue;

  // 2. Environment variable
  const envMap: Record<string, string> = {
    apiUrl: 'ANIMA_API_URL',
    apiKey: 'ANIMA_API_KEY',
    defaultOrg: 'ANIMA_DEFAULT_ORG',
    defaultIdentity: 'ANIMA_DEFAULT_IDENTITY',
    outputFormat: 'ANIMA_OUTPUT_FORMAT',
  };
  const envKey = envMap[key];
  if (envKey) {
    const envVal = process.env[envKey];
    if (envVal !== undefined && envVal !== '') return envVal;
  }

  // 3. Active profile
  const config = await getConfig();
  if (config.activeProfile && config.profiles?.[config.activeProfile]) {
    const profileVal = config.profiles[config.activeProfile][key];
    if (profileVal !== undefined) return profileVal;
  }

  // 4. Top-level defaults
  const topLevel = config[key as keyof AppConfig];
  if (topLevel !== undefined && typeof topLevel === 'string') return topLevel;

  return undefined;
}

export async function getActiveProfile(): Promise<{ name: string; config: ProfileConfig } | null> {
  const appConfig = await getConfig();
  if (!appConfig.activeProfile || !appConfig.profiles?.[appConfig.activeProfile]) return null;
  return { name: appConfig.activeProfile, config: appConfig.profiles[appConfig.activeProfile] };
}

export async function setActiveProfile(name: string): Promise<void> {
  const config = await getConfig();
  if (!config.profiles?.[name]) {
    throw new Error(`Profile "${name}" does not exist. Use 'anima config set --profile ${name} <key> <value>' to create it.`);
  }
  config.activeProfile = name;
  await saveConfig(config);
}

export async function deleteProfile(name: string): Promise<void> {
  const config = await getConfig();
  if (!config.profiles?.[name]) {
    throw new Error(`Profile "${name}" does not exist.`);
  }
  delete config.profiles[name];
  if (config.activeProfile === name) {
    config.activeProfile = undefined;
  }
  await saveConfig(config);
}

export async function listProfiles(): Promise<{ name: string; active: boolean; config: ProfileConfig }[]> {
  const config = await getConfig();
  if (!config.profiles) return [];
  return Object.entries(config.profiles).map(([name, profileConfig]) => ({
    name,
    active: config.activeProfile === name,
    config: profileConfig,
  }));
}

const VALID_CONFIG_KEYS: readonly string[] = ['apiUrl', 'apiKey', 'defaultOrg', 'defaultIdentity', 'outputFormat'] as const;

export function isValidConfigKey(key: string): key is keyof ProfileConfig {
  return VALID_CONFIG_KEYS.includes(key);
}

export function getValidConfigKeys(): readonly string[] {
  return VALID_CONFIG_KEYS;
}

async function ensureConfigDir(): Promise<string> {
  const configDir = getPaths().config;
  await mkdir(configDir, { recursive: true });
  return configDir;
}

function authConfigPath(): string {
  return join(getPaths().config, 'auth.json');
}

function appConfigPath(): string {
  return join(getPaths().config, 'config.json');
}

/**
 * Sidecar file for the Windows DPAPI backend. Lives next to auth.json so a
 * `rm -rf $config_dir` cleans both. Other platforms ignore this path.
 */
function secretsBlobPath(account: string): string {
  const safe = account.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return join(getPaths().config, `secrets-${safe}.dpapi`);
}

function store(): SecureStore {
  return getSecureStore(secretsBlobPath);
}

/**
 * Mode 0600 = read/write for owner, nothing for group/other. Even though
 * auth.json no longer holds the actual credentials, the metadata that
 * remains (apiUrl, expiry timestamps) plus the keychain entry's existence
 * still tells an attacker which Anima account to phish — defense in depth.
 * config.json gets the same treatment because the (still-plaintext) profile
 * apiKeys live there.
 */
const SECURE_FILE_MODE = 0o600;

/**
 * Write a JSON file atomically with mode 0600. Existing files keep being
 * overwritten by `writeFileSync`'s default semantics; the explicit `mode`
 * option only takes effect when the file is being created. We `chmodSync`
 * afterward so older auth.json files written with 0644 get tightened on
 * the next save.
 */
function writeSecureJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: SECURE_FILE_MODE });
  try {
    chmodSync(path, SECURE_FILE_MODE);
  } catch {
    // chmod can fail on weird filesystems (e.g., FAT-formatted USB sticks
    // some users use as their HOME on shared boxes). The data is written
    // either way; permissions are best-effort hardening.
  }
}

/**
 * Tighten an existing file's permissions to 0600 if they're laxer. Called
 * lazily on read so first-run-after-upgrade doesn't leave a 0644 file
 * sitting around between login and the next save. No-op when the file
 * already meets the bar.
 */
function tightenFileMode(path: string): void {
  try {
    const current = statSync(path).mode & 0o777;
    if (current !== SECURE_FILE_MODE) {
      chmodSync(path, SECURE_FILE_MODE);
    }
  } catch {
    // statSync / chmodSync can race with file deletion; ignore.
  }
}

/**
 * Fields that go into the OS keychain. The credentials (apiKey, refreshToken,
 * token) are obvious; `email` is here because it's PII — leaving the user's
 * identity in a world-or-user-readable file makes phishing / credential
 * stuffing easier even when the actual tokens are protected. Everything
 * else (apiUrl, expiry timestamps) stays in auth.json as recovery
 * breadcrumbs — non-sensitive and useful for a clean "your session expired"
 * message without a network round-trip.
 */
const SECRET_FIELDS = ['apiKey', 'refreshToken', 'token', 'email'] as const;
type SecretFields = Pick<AuthConfig, (typeof SECRET_FIELDS)[number]>;
type MetadataFields = Omit<AuthConfig, (typeof SECRET_FIELDS)[number]>;

function splitConfig(config: AuthConfig): { secrets: SecretFields; metadata: MetadataFields } {
  const { apiKey, refreshToken, token, email, ...metadata } = config;
  const secrets: SecretFields = {};
  if (apiKey !== undefined) secrets.apiKey = apiKey;
  if (refreshToken !== undefined) secrets.refreshToken = refreshToken;
  if (token !== undefined) secrets.token = token;
  if (email !== undefined) secrets.email = email;
  return { secrets, metadata };
}

function hasAnySecret(secrets: SecretFields): boolean {
  return SECRET_FIELDS.some((k) => secrets[k] !== undefined);
}

/**
 * Derive the keychain account name from an apiUrl. Two reasons to do this
 * instead of always using `DEFAULT_ACCOUNT`:
 *
 *   • Two simultaneous sessions (prod + local dev) coexist in the keychain
 *     instead of overwriting each other on every `am auth login --api-url=...`.
 *   • Switching back to a previously-used apiUrl restores the previous
 *     credentials without forcing a re-login (as long as the refresh token
 *     hasn't expired).
 *
 * Account name = the URL's `host` (hostname plus port if non-default),
 * lowercased. `https://api.useanima.sh` → `api.useanima.sh`,
 * `http://localhost:4001` → `localhost:4001`. URL parse failures fall
 * back to `DEFAULT_ACCOUNT` so a malformed config never crashes the CLI.
 */
function accountForApiUrl(apiUrl: string | undefined): string {
  if (!apiUrl) return DEFAULT_ACCOUNT;
  try {
    return new URL(apiUrl).host.toLowerCase();
  } catch {
    return DEFAULT_ACCOUNT;
  }
}

export async function getAuthConfig(): Promise<AuthConfig> {
  let metadata: MetadataFields = {};
  let legacySecrets: SecretFields | null = null;

  // 1. Load auth.json. May contain legacy plaintext secrets from pre-migration
  //    versions of the CLI — those are detected and migrated below.
  try {
    const p = authConfigPath();
    if (existsSync(p)) {
      tightenFileMode(p);
      const raw = JSON.parse(readFileSync(p, 'utf8')) as AuthConfig;
      const { secrets, metadata: meta } = splitConfig(raw);
      metadata = meta;
      if (hasAnySecret(secrets)) legacySecrets = secrets;
    }
  } catch {
    // Unreadable / malformed auth.json — treat as if it didn't exist.
    // Don't throw: callers expect "no auth" not "fatal error on every command".
  }

  const account = accountForApiUrl(metadata.apiUrl);

  // 2. If we found legacy plaintext secrets, migrate them into the keychain
  //    and rewrite auth.json without them. Best-effort: if the keychain write
  //    fails (e.g., libsecret missing on Linux), we surface a clean error
  //    rather than silently keep the secrets readable.
  if (legacySecrets) {
    try {
      await store().setSecret(account, JSON.stringify(legacySecrets));
      await ensureConfigDir();
      writeSecureJson(authConfigPath(), metadata);
    } catch (err) {
      // If migration fails the user's plaintext file is still on disk and
      // their CLI still works — they're just no better off than before.
      // Surface the error context but return the in-memory creds so the
      // current command can complete.
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[anima] warning: failed to migrate plaintext credentials to ` +
          `secure storage (${message}). Your auth.json still contains them.\n`,
      );
      return { ...metadata, ...legacySecrets };
    }
    return { ...metadata, ...legacySecrets };
  }

  // 3. Normal path: read secrets from the keychain.
  let secrets: SecretFields = {};
  try {
    let blob = await store().getSecret(account);
    // Backwards-compat: pre-v0.7 (the first version with this module) stored
    // everything under DEFAULT_ACCOUNT regardless of apiUrl. If the per-host
    // entry is empty and we have a hit on DEFAULT_ACCOUNT, treat it as ours,
    // re-key it to the right account, and drop the old one. This is a
    // one-time, transparent upgrade — same pattern as the file-level
    // migration above.
    if (blob === null && account !== DEFAULT_ACCOUNT) {
      const legacyBlob = await store().getSecret(DEFAULT_ACCOUNT);
      if (legacyBlob !== null) {
        try {
          await store().setSecret(account, legacyBlob);
          await store().deleteSecret(DEFAULT_ACCOUNT);
          blob = legacyBlob;
        } catch {
          // Re-key failed (write or delete). Fall back to using the legacy
          // blob in-memory; the next save will repair on its own.
          blob = legacyBlob;
        }
      }
    }
    if (blob !== null) {
      const parsed = JSON.parse(blob) as SecretFields;
      // Defensive: only copy known fields, in case future versions add new
      // ones and we're an older CLI reading a newer blob.
      for (const k of SECRET_FIELDS) {
        if (typeof parsed[k] === 'string') secrets[k] = parsed[k];
      }
    }
  } catch {
    // Backend unavailable — return metadata-only config. Caller will hit a
    // 401 from the API and tell the user to run `anima auth login`.
  }

  return { ...metadata, ...secrets };
}

export async function saveAuthConfig(config: AuthConfig): Promise<void> {
  await ensureConfigDir();
  const { secrets, metadata } = splitConfig(config);
  const account = accountForApiUrl(metadata.apiUrl);

  // Write the keychain entry first. If it fails, we want the on-disk state
  // to still reflect the *previous* successful save, not a half-applied one.
  if (hasAnySecret(secrets)) {
    await store().setSecret(account, JSON.stringify(secrets));
  } else {
    // No secrets in this save → clear the keychain entry for THIS apiUrl
    // to keep the two stores consistent (e.g., logout calls
    // saveAuthConfig({apiUrl})). Other apiUrls' entries are untouched —
    // logging out of dev should not nuke your prod session.
    await store().deleteSecret(account);
  }

  writeSecureJson(authConfigPath(), metadata);
}

export async function clearAuthConfig(): Promise<void> {
  try {
    await ensureConfigDir();
    // Need the apiUrl to know which keychain entry corresponds to the active
    // session. Read the metadata first; if the file is gone or unparseable,
    // fall through to deleting DEFAULT_ACCOUNT for symmetry with old installs.
    let account = DEFAULT_ACCOUNT;
    try {
      const p = authConfigPath();
      if (existsSync(p)) {
        const raw = JSON.parse(readFileSync(p, 'utf8')) as AuthConfig;
        account = accountForApiUrl(raw.apiUrl);
      }
    } catch {
      // file unreadable — proceed with DEFAULT_ACCOUNT
    }
    await store().deleteSecret(account);
    // Also wipe the legacy DEFAULT_ACCOUNT entry on logout — covers users
    // who upgraded mid-session and have an old default-keyed blob lying
    // around alongside the new per-host one.
    if (account !== DEFAULT_ACCOUNT) {
      await store().deleteSecret(DEFAULT_ACCOUNT);
    }
    writeSecureJson(authConfigPath(), {});
  } catch {
    // Logout must never crash the CLI — at worst the user re-runs and
    // the second call cleans up whatever the first one left.
  }
}

export async function getConfig(): Promise<AppConfig> {
  try {
    const p = appConfigPath();
    if (!existsSync(p)) return {};
    tightenFileMode(p);
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureConfigDir();
  // 0600 here too — config.json holds non-secret prefs today, but the
  // multi-profile feature stores `apiKey` per-profile in this same file.
  // Until those move into the keychain too, conservative perms are warranted.
  writeSecureJson(appConfigPath(), config);
}

export function getConfigDir(): string {
  return getPaths().config;
}
