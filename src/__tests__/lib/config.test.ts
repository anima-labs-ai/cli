import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-config');

mock.module('env-paths', () => ({
  default: () => ({
    config: testConfigDir,
    data: testConfigDir,
    cache: testConfigDir,
    log: testConfigDir,
    temp: testConfigDir,
  }),
}));

import type { InMemorySecureStore } from '../../lib/secure-store.js';

const config = await import('../../lib/config.js');
const secureStore = await import('../../lib/secure-store.js');

let memoryStore: InMemorySecureStore;

describe('config', () => {
  beforeEach(() => {
    config.resetPathsCache();
    config.setPathsOverride({
      config: testConfigDir,
      data: testConfigDir,
      cache: testConfigDir,
      log: testConfigDir,
      temp: testConfigDir,
    });
    memoryStore = new secureStore.InMemorySecureStore();
    secureStore.setSecureStoreOverride(memoryStore);
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(() => {
    secureStore.setSecureStoreOverride(null);
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe('getConfigDir', () => {
    test('returns a string path', () => {
      const dir = config.getConfigDir();
      expect(typeof dir).toBe('string');
      expect(dir.length).toBeGreaterThan(0);
    });
  });

  describe('auth config', () => {
    test('returns empty object when no config exists', async () => {
      const auth = await config.getAuthConfig();
      expect(auth).toBeDefined();
      expect(typeof auth).toBe('object');
    });

    test('saves and retrieves auth config', async () => {
      await config.saveAuthConfig({
        token: 'test-token-123',
        refreshToken: 'refresh-456',
        expiresAt: '2025-12-31T00:00:00Z',
        email: 'test@example.com',
        apiUrl: 'http://localhost:4001',
      });

      const auth = await config.getAuthConfig();
      expect(auth.token).toBe('test-token-123');
      expect(auth.refreshToken).toBe('refresh-456');
      expect(auth.email).toBe('test@example.com');
    });

    test('saves auth with apiKey', async () => {
      await config.saveAuthConfig({
        apiKey: 'sk_test_key',
        email: 'api@example.com',
      });

      const auth = await config.getAuthConfig();
      expect(auth.apiKey).toBe('sk_test_key');
      expect(auth.email).toBe('api@example.com');
    });

    test('clearAuthConfig removes stored credentials', async () => {
      await config.saveAuthConfig({
        token: 'to-be-cleared',
        email: 'clear@example.com',
      });

      await config.clearAuthConfig();
      const auth = await config.getAuthConfig();
      expect(auth.token).toBeUndefined();
      expect(auth.email).toBeUndefined();
    });

    test('secret fields never land in auth.json on disk', async () => {
      await config.saveAuthConfig({
        apiKey: 'oat_supersecret',
        refreshToken: 'ort_alsosecret',
        token: 'tok_thirdsecret',
        apiUrl: 'https://api.useanima.sh',
        email: 'me@example.com',
        expiresAt: '2026-06-01T00:00:00Z',
      });

      const onDisk = readFileSync(join(testConfigDir, 'auth.json'), 'utf8');
      // Whole-string check — if any of the secret prefixes or PII appear in
      // the file we've regressed and leaked credentials back to plaintext.
      expect(onDisk).not.toContain('oat_supersecret');
      expect(onDisk).not.toContain('ort_alsosecret');
      expect(onDisk).not.toContain('tok_thirdsecret');
      expect(onDisk).not.toContain('me@example.com');
      // Non-secret metadata is fine to see.
      expect(onDisk).toContain('api.useanima.sh');
      expect(onDisk).toContain('2026-06-01');

      // And the keychain backend got them.
      const blob = await memoryStore.getSecret(secureStore.DEFAULT_ACCOUNT);
      expect(blob).not.toBeNull();
      const parsed = JSON.parse(blob ?? '{}');
      expect(parsed.apiKey).toBe('oat_supersecret');
      expect(parsed.refreshToken).toBe('ort_alsosecret');
      expect(parsed.token).toBe('tok_thirdsecret');
      expect(parsed.email).toBe('me@example.com');
    });

    test('migrates legacy plaintext auth.json on first read', async () => {
      // Simulate an existing CLI install: plaintext file with secrets in it.
      const legacyPath = join(testConfigDir, 'auth.json');
      mkdirSync(testConfigDir, { recursive: true });
      writeFileSync(
        legacyPath,
        JSON.stringify({
          apiKey: 'oat_legacy',
          refreshToken: 'ort_legacy',
          expiresAt: '2026-06-01T00:00:00Z',
          apiUrl: 'https://api.useanima.sh',
          email: 'old@example.com',
        }),
      );

      // First read should return everything AND quietly migrate.
      const auth = await config.getAuthConfig();
      expect(auth.apiKey).toBe('oat_legacy');
      expect(auth.refreshToken).toBe('ort_legacy');
      expect(auth.email).toBe('old@example.com');

      // After migration: secrets (including email PII) are in the keychain,
      // gone from the file. Only non-sensitive metadata remains on disk.
      const afterFile = readFileSync(legacyPath, 'utf8');
      expect(afterFile).not.toContain('oat_legacy');
      expect(afterFile).not.toContain('ort_legacy');
      expect(afterFile).not.toContain('old@example.com');
      expect(afterFile).toContain('api.useanima.sh');

      const blob = await memoryStore.getSecret(secureStore.DEFAULT_ACCOUNT);
      const parsed = JSON.parse(blob ?? '{}');
      expect(parsed.apiKey).toBe('oat_legacy');
      expect(parsed.refreshToken).toBe('ort_legacy');
      expect(parsed.email).toBe('old@example.com');

      // Subsequent reads should NOT trigger a second migration — the file
      // is now clean, so getAuthConfig pulls from the keychain only.
      const auth2 = await config.getAuthConfig();
      expect(auth2.apiKey).toBe('oat_legacy');
    });

    test('saveAuthConfig with no secrets clears the keychain entry', async () => {
      // Seed a previous login.
      await config.saveAuthConfig({
        apiKey: 'oat_existing',
        apiUrl: 'https://api.useanima.sh',
      });
      expect(await memoryStore.getSecret(secureStore.DEFAULT_ACCOUNT)).not.toBeNull();

      // saveAuthConfig({apiUrl: ...}) is the SESSION_EXPIRED wipe path in
      // auth.ts — preserves apiUrl, drops creds. The keychain entry must go
      // along for the ride or we'd leak the dead refresh token.
      await config.saveAuthConfig({ apiUrl: 'https://api.useanima.sh' });
      expect(await memoryStore.getSecret(secureStore.DEFAULT_ACCOUNT)).toBeNull();
    });
  });

  describe('app config', () => {
    test('returns empty object when no config exists', async () => {
      const cfg = await config.getConfig();
      expect(cfg).toBeDefined();
      expect(typeof cfg).toBe('object');
    });

    test('saves and retrieves app config', async () => {
      await config.saveConfig({
        defaultOrg: 'org-123',
        defaultIdentity: 'id-456',
        outputFormat: 'json',
      });

      const cfg = await config.getConfig();
      expect(cfg.defaultOrg).toBe('org-123');
      expect(cfg.defaultIdentity).toBe('id-456');
      expect(cfg.outputFormat).toBe('json');
    });

    test('preserves existing config on partial update', async () => {
      await config.saveConfig({
        defaultOrg: 'org-first',
        outputFormat: 'table',
      });

      await config.saveConfig({
        defaultOrg: 'org-second',
      });

      const cfg = await config.getConfig();
      expect(cfg.defaultOrg).toBe('org-second');
    });
  });
});
