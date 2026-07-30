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
  _warnedExpiredProfiles.clear();
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
  /**
   * Orgs this machine has been enrolled for, keyed by org id.
   *
   * A non-secret marker only — the grant itself lives in the keychain behind a
   * human-presence gate. It exists because "are we enrolled?" has to be
   * answerable *without* prompting: reading the grant is what raises the
   * password dialog, so probing the keychain to decide whether a dialog is
   * warranted would raise one every time, including when the answer is no.
   */
  enrollments?: Record<string, EnrollmentRecord>;
}

export interface EnrollmentRecord {
  enrolledAt: string;
  /** When the grant lapses and enrolling again costs another emailed code. */
  grantExpiresAt: string;
}

export interface ProfileConfig {
  apiUrl?: string;
  apiKey?: string;
  defaultOrg?: string;
  defaultIdentity?: string;
  outputFormat?: 'table' | 'json' | 'yaml';
  /**
   * When this profile's credential stops working, ISO-8601. Only set for
   * profiles holding a short-lived key (`am auth elevate` mints a 15-minute
   * one); a durable profile leaves it undefined and never expires.
   */
  expiresAt?: string;
}

/**
 * Which layer a resolved value came from. `flag` and `env` name themselves;
 * `profile` carries the profile's name, because "from a profile" is not
 * actionable when you have three of them and want to know which one just
 * decided who you are sending as.
 */
export type ConfigSource =
  | { layer: 'flag' }
  | { layer: 'env'; variable: string }
  | { layer: 'profile'; name: string }
  | { layer: 'config' };

/**
 * Layered config resolution: flags > env > profile > defaults, reporting which
 * layer answered.
 *
 * Split out from [[resolveConfigValue]] rather than duplicated beside it: the
 * value and its provenance are read from the same four checks in the same
 * order, so a second implementation would eventually disagree with the first
 * and mislabel where a value came from — the failure mode being a caller that
 * tells you the identity came from your config file while it actually came
 * from a stale `ANIMA_DEFAULT_IDENTITY` in the shell. `resolveConfigValue`
 * delegates here for exactly that reason.
 */
export async function resolveConfigValueWithSource(
  key: keyof ProfileConfig,
  flagValue?: string,
): Promise<{ value: string; source: ConfigSource } | undefined> {
  // 1. CLI flag (highest priority)
  if (flagValue !== undefined && flagValue !== '') {
    return { value: flagValue, source: { layer: 'flag' } };
  }

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
    if (envVal !== undefined && envVal !== '') {
      return { value: envVal, source: { layer: 'env', variable: envKey } };
    }
  }

  // 3. Active profile
  const config = await getConfig();
  if (config.activeProfile && config.profiles?.[config.activeProfile]) {
    const profileVal = config.profiles[config.activeProfile][key];
    if (profileVal !== undefined) {
      return { value: profileVal, source: { layer: 'profile', name: config.activeProfile } };
    }
  }

  // 4. Top-level defaults
  const topLevel = config[key as keyof AppConfig];
  if (topLevel !== undefined && typeof topLevel === 'string') {
    return { value: topLevel, source: { layer: 'config' } };
  }

  return undefined;
}

/**
 * Layered config resolution: flags > env > profile > defaults
 */
export async function resolveConfigValue(key: keyof ProfileConfig, flagValue?: string): Promise<string | undefined> {
  return (await resolveConfigValueWithSource(key, flagValue))?.value;
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

/**
 * Stop using any profile, without deleting it.
 *
 * The counterpart `setActiveProfile` never had. "No profile" is a real state —
 * `activeProfile` unset, so top-level config answers — but the only way to
 * reach it was `deleteProfile`, which destroys the credential too. A user who
 * elevated and wanted their ordinary identity back had to throw away the
 * session to get it.
 */
export async function clearActiveProfile(): Promise<void> {
  const config = await getConfig();
  if (config.activeProfile === undefined) return;
  await saveConfig({ ...config, activeProfile: undefined });
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
  // Remove the keychain entry too — saveConfig only manages entries for
  // profiles that still exist in the AppConfig, so a deleted profile would
  // otherwise leave an orphaned credential behind. Idempotent on a missing
  // entry, so safe even when the profile predates secure storage.
  try {
    await store().deleteSecret(accountForProfile(name));
  } catch {
    // Backend unavailable — let the file write proceed; the next time the
    // keychain is reachable the orphan can be cleaned up manually.
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
 * The same secure store this module uses, for callers outside it.
 *
 * Exported rather than letting them call `getSecureStore()` themselves: the
 * Windows backend needs `secretsBlobPath` to know where its encrypted blob
 * lives, and a bare call would silently select a different location. One
 * accessor keeps every caller on one backend and one path.
 */
export function secureStore(): SecureStore {
  return store();
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

// ── Named profiles (config.json) ────────────────────────────────────────────
//
// `AppConfig.profiles[name]` mirrors `AuthConfig`'s split: the apiKey is
// secret, everything else (apiUrl, defaultOrg, defaultIdentity, outputFormat)
// is non-sensitive metadata. Same store, same kind of encoding — but a
// separate account namespace (`profile:<name>`) so profile credentials don't
// collide with the active-session entry keyed by host.

const PROFILE_SECRET_FIELDS = ['apiKey'] as const;
type ProfileSecretFields = Pick<ProfileConfig, (typeof PROFILE_SECRET_FIELDS)[number]>;
type ProfileMetadataFields = Omit<ProfileConfig, (typeof PROFILE_SECRET_FIELDS)[number]>;

function splitProfile(profile: ProfileConfig): {
  secrets: ProfileSecretFields;
  metadata: ProfileMetadataFields;
} {
  const { apiKey, ...metadata } = profile;
  const secrets: ProfileSecretFields = {};
  if (apiKey !== undefined) secrets.apiKey = apiKey;
  return { secrets, metadata };
}

function hasAnyProfileSecret(secrets: ProfileSecretFields): boolean {
  return PROFILE_SECRET_FIELDS.some((k) => secrets[k] !== undefined);
}

/**
 * Account name for a named profile's keychain entry. Prefixed with
 * `profile:` so it can't collide with auth.json's host-keyed accounts —
 * a user with a profile literally named `api.useanima.sh` won't blow
 * away their active session.
 */
function accountForProfile(name: string): string {
  return `profile:${name}`;
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

  // 4. An active profile's credential outranks auth.json's. See
  //    `activeProfileCredential` for why this has to happen here.
  const fromProfile = await activeProfileCredential();
  if (fromProfile) {
    return {
      ...metadata,
      ...secrets,
      apiKey: fromProfile.apiKey,
      // A profile credential is only valid against the host it was issued
      // for, so the URL has to travel with it. Without this, elevating on a
      // staging profile would send a staging key to production.
      apiUrl: fromProfile.apiUrl ?? metadata.apiUrl,
      // auth.json's OAuth session does not carry over to a profile identity.
      // Leaving it would let `ensureFreshOAuthToken` refresh, and
      // `ensureAuthHeaders` prefer, a token the profile did not select.
      token: undefined,
      refreshToken: undefined,
    };
  }

  return { ...metadata, ...secrets };
}

/**
 * Suffix marking a profile as a privileged *session* rather than an identity.
 *
 * Only `am auth elevate` writes one. Lives here rather than in elevation.ts
 * because `activeProfileCredential` has to recognise one, and elevation.ts
 * already depends on this module — the other direction would be a cycle.
 */
export const ELEVATED_PROFILE_SUFFIX = 'elevated';

/**
 * Is this profile a privileged session rather than a durable identity?
 *
 * Matches both names `elevatedProfileName` can produce: `<orgId>-elevated`,
 * and the bare `elevated` used when no default org is set. Exported so the two
 * are decided in one place — a predicate that missed the bare form would leave
 * exactly the org-less setup unable to recover from a stale session.
 */
export function isElevatedProfileName(name: string): boolean {
  return name === ELEVATED_PROFILE_SUFFIX || name.endsWith(`-${ELEVATED_PROFILE_SUFFIX}`);
}

/** Session profiles already warned about, so the notice is emitted once per run. */
const _warnedExpiredProfiles = new Set<string>();

/** True when `iso` names a moment already past. Absent/unparseable → not expired. */
function hasLapsed(iso: string | undefined): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && at <= Date.now();
}

/**
 * Has this profile's credential stopped working?
 *
 * A session profile with no recorded expiry is treated as lapsed rather than
 * as eternal. Sessions last minutes, and `expiresAt` is absent only on ones
 * written before the CLI recorded it — so by the time anything reads such a
 * profile, its key is certainly dead.
 *
 * That case is a real migration, not a hypothetical: elevating with the
 * previous CLI left an active `<org>-elevated` profile holding a 15-minute key
 * and no expiry. Nothing read profiles then, so it was inert. The moment
 * profiles began supplying the credential it became the *selected* one, and
 * every command started failing with "Session expired. Run `am auth login`" —
 * advice that is wrong twice over, since the agent key underneath is fine and
 * `auth login` is not how this profile is refreshed.
 *
 * Only session profiles get this treatment. An ordinary profile is a durable
 * identity whose key legitimately has no expiry, and standing those down would
 * lock people out of exactly the credential they chose.
 *
 * Exported because `elevation.ts` has to answer the same question when it
 * decides whether to skip the password dialog. It used to decide for itself,
 * and reached the opposite conclusion about the case this whole comment is
 * about — an expiry-less session counted as *live* there while counting as
 * dead here. One predicate, asked twice, cannot drift.
 */
export function profileCredentialLapsed(name: string, profile: ProfileConfig): boolean {
  if (hasLapsed(profile.expiresAt)) return true;
  return profile.expiresAt === undefined && isElevatedProfileName(name);
}

/**
 * The active profile's credential, when it has one that still works.
 *
 * Profiles were always meant to switch identity — `am init` writes one per
 * org and `am config profile show` prints its API key — but nothing in the
 * credential path ever read one back. `getAuthConfig` sourced the key solely
 * from auth.json, so `am config profile use X` and `am auth elevate` both
 * changed which profile was *marked* active while every request kept going
 * out under auth.json's key. `am tail` after a successful elevate still got
 * "master key required" for exactly this reason: the master key was sitting
 * in the keychain under `profile:<name>`, which no caller read.
 *
 * Fixing it here rather than in `ensureAuthHeaders` keeps one source of truth
 * — `resolveApiUrl` and the oRPC link both come through `getAuthConfig`, and
 * patching only the header path would have left them disagreeing about which
 * host the request belongs to. `ANIMA_API_KEY` still wins, because
 * `ensureAuthHeaders` applies it above whatever this returns.
 */
async function activeProfileCredential(): Promise<{ apiKey: string; apiUrl?: string } | null> {
  let active: { name: string; config: ProfileConfig } | null;
  try {
    active = await getActiveProfile();
  } catch {
    // config.json unreadable — auth.json stays authoritative rather than
    // locking the user out of every command.
    return null;
  }
  if (!active?.config.apiKey) return null;

  // A short-lived profile has to stop being used the moment it lapses.
  // Silently sending the dead key would turn an expected 15-minute expiry
  // into an unexplained 401 on every later command, and the user would have
  // no reason to connect the two.
  if (profileCredentialLapsed(active.name, active.config)) {
    // Once per process. `getAuthConfig` is called for each URL and header
    // resolution, so a bare write repeated the same line four times before a
    // single command's output — enough noise to read as four separate faults.
    if (!_warnedExpiredProfiles.has(active.name)) {
      _warnedExpiredProfiles.add(active.name);
      process.stderr.write(
        `[anima] admin session "${active.name}" has expired; using your default credential instead. ` +
          'Run `am auth elevate` when you next need admin access.\n',
      );
    }
    return null;
  }

  return { apiKey: active.config.apiKey, apiUrl: active.config.apiUrl };
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
  let raw: AppConfig = {};
  try {
    const p = appConfigPath();
    if (!existsSync(p)) return {};
    tightenFileMode(p);
    raw = JSON.parse(readFileSync(p, 'utf8')) as AppConfig;
  } catch {
    return {};
  }

  // No profiles → nothing to merge from the keychain. Return as-is to keep
  // the no-profiles fast-path zero-cost.
  if (!raw.profiles || Object.keys(raw.profiles).length === 0) return raw;

  // Walk each profile: detect legacy plaintext apiKeys, migrate them, and
  // pull keychain-resident apiKeys back into the in-memory config so
  // resolveConfigValue / getActiveProfile see the merged view.
  let mutatedProfiles = false;
  const merged: Record<string, ProfileConfig> = {};

  for (const [name, profile] of Object.entries(raw.profiles)) {
    const { secrets, metadata } = splitProfile(profile);

    if (hasAnyProfileSecret(secrets)) {
      // Legacy: apiKey is sitting in config.json. Move it.
      try {
        await store().setSecret(accountForProfile(name), JSON.stringify(secrets));
        mutatedProfiles = true;
        merged[name] = { ...metadata, ...secrets };
      } catch (err) {
        // Keychain unavailable — leave the profile as-is and warn once. Same
        // failure mode as the auth.json migration.
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[anima] warning: failed to migrate profile "${name}" credentials ` +
            `to secure storage (${message}). config.json still contains them.\n`,
        );
        merged[name] = profile;
      }
      continue;
    }

    // Normal path: pull the keychain entry, if any, and merge.
    try {
      const blob = await store().getSecret(accountForProfile(name));
      if (blob !== null) {
        const parsed = JSON.parse(blob) as ProfileSecretFields;
        const fromKeychain: ProfileSecretFields = {};
        for (const k of PROFILE_SECRET_FIELDS) {
          if (typeof parsed[k] === 'string') fromKeychain[k] = parsed[k];
        }
        merged[name] = { ...metadata, ...fromKeychain };
        continue;
      }
    } catch {
      // Backend unavailable — surface metadata-only profile, same posture
      // as auth.json's miss path.
    }
    merged[name] = metadata;
  }

  // If we migrated any profile from plaintext, persist the cleaned-up file
  // so the leak window closes immediately rather than waiting for the next
  // saveConfig call.
  if (mutatedProfiles) {
    const cleaned: AppConfig = { ...raw };
    cleaned.profiles = Object.fromEntries(
      Object.entries(merged).map(([n, p]) => [n, splitProfile(p).metadata]),
    );
    try {
      writeSecureJson(appConfigPath(), cleaned);
    } catch {
      // Best-effort: the next saveConfig will retry. Returning the merged
      // view is still correct.
    }
  }

  return { ...raw, profiles: merged };
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureConfigDir();

  // Strip profile apiKeys into the keychain before writing the file. We
  // mutate a clone so callers' references aren't affected — saveConfig has
  // historically been called with `{...await getConfig(), ...patch}` where
  // both shapes coexist briefly.
  const onDisk: AppConfig = { ...config };
  if (config.profiles) {
    const profilesForFile: Record<string, ProfileConfig> = {};
    for (const [name, profile] of Object.entries(config.profiles)) {
      const { secrets, metadata } = splitProfile(profile);
      const account = accountForProfile(name);
      if (hasAnyProfileSecret(secrets)) {
        await store().setSecret(account, JSON.stringify(secrets));
      } else {
        // Profile exists but has no apiKey in this save → ensure no stale
        // keychain entry hangs around (e.g., user explicitly cleared it).
        await store().deleteSecret(account);
      }
      profilesForFile[name] = metadata;
    }
    onDisk.profiles = profilesForFile;
  }

  // 0600 because even the metadata (apiUrl, defaultOrg, defaultIdentity,
  // active profile name) reveals enough about the user's setup to inform
  // a phishing or credential-stuffing attempt. Same posture as auth.json.
  writeSecureJson(appConfigPath(), onDisk);
}

export function getConfigDir(): string {
  return getPaths().config;
}
