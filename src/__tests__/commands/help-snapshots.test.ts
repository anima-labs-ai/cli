import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestContext } from '../helpers/test-utils.js';

const snapshotDir = join(import.meta.dir, '..', 'snapshots');

const commandGroups = [
  'auth',
  'identity',
  'email',
  'phone',
  'card',
  'vault',
  'config',
  'setup-mcp',
  'extension',
  'admin',
  'init',
] as const;

describe('golden help snapshots', () => {
  test('command group help text matches golden snapshots', () => {
    const ctx = createTestContext();
    try {
      for (const commandName of commandGroups) {
        const command = ctx.program.commands.find((item) => item.name() === commandName);
        expect(command).toBeDefined();

        const actual = `${command?.helpInformation() ?? ''}`;
        const expected = readFileSync(join(snapshotDir, `${commandName}.help.txt`), 'utf-8');
        expect(actual).toBe(expected);
      }
    } finally {
      ctx.cleanup();
    }
  });
});
