/**
 * Proves the `process.exit` guard is actually installed for this run.
 *
 * The guard lives in a preload (bunfig.toml `[test] preload`), which is the
 * only way to protect a run without every future test remembering to opt in —
 * and also the only part of the suite whose loss nothing else would notice.
 * Deleting the `[test]` block, renaming the helper, or invoking `bun test` from
 * somewhere bunfig.toml is not picked up would each quietly restore the old
 * behaviour: one `process.exit()` ending the run, discarding failures already
 * recorded, and exiting 0 when the caller passed 0.
 *
 * **This file imports nothing from the helper, deliberately.** Importing it
 * would execute it, and executing it installs the guard — so an importing test
 * would pass with the preload entirely unwired, which is precisely the
 * regression being checked. Everything below is therefore asserted structurally
 * (a global set by the preload; the thrown value's `name` and `code`) rather
 * than through `instanceof ProcessExitError`.
 */
import { describe, test, expect } from 'bun:test';

/** Catch and return, so a missing guard shows up as `undefined`, not a dead run. */
function exitError(code: number): { name?: string; code?: number } | undefined {
  // Called through a non-`never` alias on purpose. `process.exit` is typed as
  // returning `never`, which makes TypeScript treat everything after the call
  // as unreachable — including the `return undefined` that reports a missing
  // guard. Under the guard it genuinely does return control (by throwing), so
  // the `never` is the inaccurate half here.
  const exit = process.exit as unknown as (code: number) => void;
  try {
    exit(code);
  } catch (error: unknown) {
    return error as { name?: string; code?: number };
  }
  return undefined;
}

describe('process.exit guard', () => {
  test('the preload ran — bunfig.toml still wires it up', () => {
    // Set by src/__tests__/helpers/no-process-exit.ts. Nothing in this file
    // imports that module, so this is true only if the preload loaded it.
    expect(globalThis.__ANIMA_PROCESS_EXIT_GUARD__).toBe(true);
  });

  test('process.exit throws instead of ending the run', () => {
    // Without the guard this call terminates the runner, and every result
    // recorded so far — including any failure — is discarded. The assertion
    // would never be reached to disagree.
    expect(exitError(1)?.name).toBe('ProcessExitError');
  });

  test('a zero exit is intercepted too — that is the one that turns CI green', () => {
    expect(exitError(0)?.name).toBe('ProcessExitError');
    expect(exitError(0)?.code).toBe(0);
  });

  test('the exit code is preserved, so tests can assert on it', () => {
    // 2 is the CLI's convention for bad input; a test asserting a usage error
    // needs to tell it apart from a 1.
    expect(exitError(2)?.code).toBe(2);
  });
});
