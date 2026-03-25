import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
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

const config = await import('../../lib/config.js');

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
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(() => {
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
