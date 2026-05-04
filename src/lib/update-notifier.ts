import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import envPaths from 'env-paths';

// Update-check cadence. Avoids hitting npm on every CLI invocation. Stripe
// link-cli uses a similar pattern.
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REGISTRY_TIMEOUT_MS = 1500;

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  update_command: string;
}

interface CacheShape {
  checkedAt: number;
  latestVersion: string;
}

function cachePath(): string {
  const paths = envPaths('anima', { suffix: '' });
  return join(paths.cache, 'update-check.json');
}

function readCache(): CacheShape | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CacheShape;
  } catch {
    return null;
  }
}

async function writeCache(data: CacheShape): Promise<void> {
  const path = cachePath();
  try {
    await mkdir(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(data));
  } catch {
    // Cache failures are silent — don't break the CLI for a non-critical write.
  }
}

async function fetchLatestVersion(packageName: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Compare semver strings via numeric segments. Avoids pulling in `semver`.
function isNewer(latest: string, current: string): boolean {
  const stripPrerelease = (v: string) => v.split('-')[0]?.split('+')[0] ?? v;
  const lp = stripPrerelease(latest).split('.').map((n) => Number.parseInt(n, 10));
  const cp = stripPrerelease(current).split('.').map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < Math.max(lp.length, cp.length); i++) {
    const a = lp[i] ?? 0;
    const b = cp[i] ?? 0;
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

export async function checkForUpdate(
  packageName: string,
  currentVersion: string,
): Promise<UpdateInfo | null> {
  if (process.env.NO_UPDATE_NOTIFIER === '1' || process.env.CI === 'true') return null;

  const cached = readCache();
  const now = Date.now();
  let latestVersion = cached?.latestVersion ?? null;

  if (!cached || now - cached.checkedAt > CHECK_INTERVAL_MS) {
    const fetched = await fetchLatestVersion(packageName);
    if (fetched) {
      latestVersion = fetched;
      await writeCache({ checkedAt: now, latestVersion: fetched });
    }
  }

  if (!latestVersion) return null;
  if (!isNewer(latestVersion, currentVersion)) return null;

  return {
    current_version: currentVersion,
    latest_version: latestVersion,
    update_command: `npm install -g ${packageName}`,
  };
}
