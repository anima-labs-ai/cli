import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { runCapturingExit } from '../helpers/test-utils.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-vault-audit-config');

mock.module('env-paths', () => ({
  default: () => ({
    config: testConfigDir,
    data: testConfigDir,
    cache: testConfigDir,
    log: testConfigDir,
    temp: testConfigDir,
  }),
}));

const { createProgram } = await import('../../cli.js');

const fixtureDir = join(testConfigDir, 'fixtures');
const leakyFile = join(fixtureDir, 'leaky.ts');
const cleanFile = join(fixtureDir, 'clean.ts');
const missingFile = join(fixtureDir, 'does-not-exist.ts');

describe('vault audit', () => {
  let program: Command;

  beforeEach(() => {
    resetPathsCache();
    setPathsOverride({
      config: testConfigDir,
      data: testConfigDir,
      cache: testConfigDir,
      log: testConfigDir,
      temp: testConfigDir,
    });
    program = createProgram();
    mkdirSync(fixtureDir, { recursive: true });
    // AKIA + 16 uppercase-alnum is the AWS access-key shape the scanner pins.
    writeFileSync(leakyFile, 'const aws = "AKIAIOSFODNN7EXAMPLE";\n');
    writeFileSync(cleanFile, 'const ok = process.env.SAFE_VALUE;\n');
  });

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  // `--check` is a CI gate. A path that does not exist is not a clean scan —
  // it is a scan that never happened. Exiting 0 turns a typo'd path in a
  // pipeline config into a permanently green secret-scanning step.
  test('--check fails when a requested path does not exist', async () => {
    const result = await runCapturingExit(program, ['vault', 'audit', '--check', missingFile]);

    expect(result.code).toBe(1);
  });

  test('--check still passes on a clean, existing path', async () => {
    const result = await runCapturingExit(program, ['vault', 'audit', '--check', cleanFile]);

    expect(result.code).toBeUndefined();
  });

  test('--check fails on a real finding', async () => {
    const result = await runCapturingExit(program, ['vault', 'audit', '--check', leakyFile]);

    expect(result.code).toBe(1);
  });

  // The agent format is the default whenever stdout is not a TTY, which is
  // every CI job and every agent invocation. `--fix` is not implemented, and
  // its notice went out through `output.info` — human-only decoration. So the
  // caller most likely to be automated got exit 0 and no signal at all.
  test('--fix announces that it changed nothing, in the agent format', async () => {
    const result = await runCapturingExit(program, ['vault', 'audit', '--fix', leakyFile]);

    const printed = result.logs.join('\n');
    expect(printed).toContain('not yet implemented');
  });

  // Same root cause: findings themselves were printed with `output.info`, so
  // an agent was told "Found 2 potential secret(s)" and never which two.
  test('findings are machine-readable in the agent format', async () => {
    const result = await runCapturingExit(program, ['vault', 'audit', leakyFile]);

    const printed = result.logs.join('\n');
    expect(printed).toContain('AWS access key');
    expect(printed).toContain('leaky.ts');
  });

  // The command has always advertised "unresolved vault references", but the
  // array backing that claim was declared and never written to, so the check
  // did nothing. An unresolved `{{vault:...}}` committed to a repo is a real
  // defect — it is the exact string `inject` now refuses to emit — and a vtk_
  // token in a file is a leaked (if short-lived) credential.
  test('flags an unresolved vault template', async () => {
    const file = join(fixtureDir, 'ref.ts');
    writeFileSync(file, 'const k = "{{vault:caaa00000000000000000crd01:login.password}}";\n');

    const result = await runCapturingExit(program, ['vault', 'audit', file]);

    expect(result.logs.join('\n')).toContain('{{vault:');
  });

  // Deliberately looser than inject's own parser: `{{vault:cred}}` without a
  // field is exactly the shape inject silently ignores, so it is the shape
  // most worth surfacing here.
  test('flags a malformed vault template too', async () => {
    const file = join(fixtureDir, 'ref-malformed.ts');
    writeFileSync(file, 'const k = "{{vault:my-cred}}";\n');

    const result = await runCapturingExit(program, ['vault', 'audit', file]);

    expect(result.logs.join('\n')).toContain('{{vault:');
  });

  test('flags a vtk_ token left in a file', async () => {
    const file = join(fixtureDir, 'ref-vtk.ts');
    writeFileSync(file, `const t = "vtk_${'a'.repeat(64)}";\n`);

    const result = await runCapturingExit(program, ['vault', 'audit', file]);

    expect(result.logs.join('\n')).toContain('vtk_');
  });

  test('--check fails on an unresolved reference', async () => {
    const file = join(fixtureDir, 'ref-check.ts');
    writeFileSync(file, 'const k = "{{vault:caaa00000000000000000crd01:login.password}}";\n');

    const result = await runCapturingExit(program, ['vault', 'audit', '--check', file]);

    expect(result.code).toBe(1);
  });

  test('a file with neither secrets nor references still passes', async () => {
    const result = await runCapturingExit(program, ['vault', 'audit', '--check', cleanFile]);

    expect(result.code).toBeUndefined();
  });

  // The `--fix` hint pointed at `am vault run`, which has never existed.
  test('--fix hint names a command that exists', async () => {
    const result = await runCapturingExit(program, ['vault', 'audit', '--fix', leakyFile]);

    const printed = result.logs.join('\n');
    expect(printed).not.toContain('vault run');
  });
});
