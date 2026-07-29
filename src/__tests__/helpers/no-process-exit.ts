/**
 * Test-run guard: `process.exit()` must never terminate the test runner.
 *
 * Loaded once via `[test] preload` in bunfig.toml, before any test file. It is
 * deliberately not opt-in — the failure it prevents is one nobody notices in
 * time to opt in.
 *
 * ## What went wrong without it
 *
 * `bun test` runs every test file in a single process, so a `process.exit()`
 * reached through product code ends the *run*, not the test. The CLI reaches
 * one easily: `Output.fatal()` (src/lib/output.ts) is 68 call sites deep in
 * command actions and exits by design, and `init`'s `bail()` exits on a
 * cancelled prompt. Whatever bun had not run yet simply never ran, and was not
 * reported as skipped — the run stopped mid-file with no summary line.
 *
 * Worse, the exit *code* is whatever the caller passed. `bail()` passes 0, and
 * bun's file order is not the order you list them, so a run could look like:
 *
 *     (fail) a real failing test        <- ran, failed, was reported
 *     …some other file calls exit(0)    <- run ends here
 *     $ echo $?
 *     0                                 <- green. The failure is gone.
 *
 * A recorded failure erased into a passing CI run is the reason this is a
 * hard guard rather than a lint rule or a convention.
 *
 * ## What it does instead
 *
 * Throws [[ProcessExitError]]. Throwing (rather than the no-op stub some tests
 * used to install by hand) keeps the one thing callers rely on: `fatal()` is
 * typed `never`, and code after it must not run. A no-op lets execution
 * continue past a fatal with state the author had already given up on.
 *
 * It cannot be swallowed into a silent pass. Command actions catch and forward
 * to `handleOrpcError`, which is itself `never` and ends in another
 * `output.fatal()` — so the throw re-raises out of the catch. The worst case is
 * one misleading error line rendered on the way out, not a lost failure.
 *
 * ## Asserting on exits
 *
 * A test that wants to prove a command exits, and with which code, can catch
 * this rather than stub anything:
 *
 *     let exit: ProcessExitError | undefined;
 *     try { await program.parseAsync(argv, { from: 'user' }); }
 *     catch (error) { if (error instanceof ProcessExitError) exit = error; }
 *     expect(exit?.code).toBe(2);
 */

export class ProcessExitError extends Error {
  constructor(readonly code: number) {
    super(
      `process.exit(${code}) was called during a test. It was intercepted: ` +
        'letting it through would end the whole test run, discarding every ' +
        'result recorded so far and every file not yet reached. If the code ' +
        'under test is meant to exit, catch ProcessExitError and assert on ' +
        '.code; see src/__tests__/helpers/no-process-exit.ts.',
    );
    this.name = 'ProcessExitError';
  }
}

/**
 * Marker proving the guard is installed, published on `globalThis` rather than
 * as an export.
 *
 * The distinction is the whole point. Importing this module *installs* the
 * guard as a side effect, so a test that imports it can never observe the
 * guard missing — it would pass just as happily with the `[test]` block deleted
 * from bunfig.toml, which is the one regression the check exists to catch. A
 * global can only be set by something that already loaded the module, so a test
 * that reads it *without importing anything from here* is really asking "did
 * the preload run", and fails when the answer is no.
 */
declare global {
  // `var` is required here: it is the only declaration form that augments
  // globalThis in an ambient block.
  var __ANIMA_PROCESS_EXIT_GUARD__: boolean | undefined;
}

globalThis.__ANIMA_PROCESS_EXIT_GUARD__ = true;

process.exit = ((code?: number | string | null): never => {
  throw new ProcessExitError(typeof code === 'number' ? code : 0);
}) as typeof process.exit;
