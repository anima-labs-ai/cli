import envPaths from 'env-paths';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

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
}

export function setPathsOverride(paths: ReturnType<typeof envPaths>): void {
  _pathsOverride = paths;
}

export interface AuthConfig {
  token?: string;
  refreshToken?: string;
  expiresAt?: string;
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
    throw new Error(`Profile "${name}" does not exist. Use 'am config set --profile ${name} <key> <value>' to create it.`);
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

export async function getAuthConfig(): Promise<AuthConfig> {
  try {
    const file = Bun.file(authConfigPath());
    if (!(await file.exists())) return {};
    return await file.json();
  } catch {
    return {};
  }
}

export async function saveAuthConfig(config: AuthConfig): Promise<void> {
  await ensureConfigDir();
  await Bun.write(authConfigPath(), JSON.stringify(config, null, 2));
}

export async function clearAuthConfig(): Promise<void> {
  try {
    await ensureConfigDir();
    await Bun.write(authConfigPath(), JSON.stringify({}, null, 2));
  } catch {

  }
}

export async function getConfig(): Promise<AppConfig> {
  try {
    const file = Bun.file(appConfigPath());
    if (!(await file.exists())) return {};
    return await file.json();
  } catch {
    return {};
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureConfigDir();
  await Bun.write(appConfigPath(), JSON.stringify(config, null, 2));
}

export function getConfigDir(): string {
  return getPaths().config;
}
