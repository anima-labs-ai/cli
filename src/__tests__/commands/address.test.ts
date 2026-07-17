import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import { runCapturingExit } from '../helpers/test-utils.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-address-config');

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

const ADDRESS_ID = 'caaa00000000000000000adr01';
const AGENT_ID = 'caaa00000000000000000agt01';

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let program: Command;
let validateResponse: Record<string, unknown> = {};

// A full ValidateAddressOutput shape: the contract derives the output type
// from a Zod schema, so a partial mock leaves typed fields undefined and the
// command crashes on something unrelated to what we're testing.
function buildValidateResponse(valid: boolean): Record<string, unknown> {
  const address = {
    street1: '1 Market St',
    street2: null,
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94105',
    country: 'US',
  };
  return {
    valid,
    confidence: valid ? 0.99 : 0.21,
    standardized: address,
    suggestions: valid ? [] : [{ ...address, street1: '1 Market Street' }],
  };
}

/**
 * `address validate` reports a verdict, and that verdict is the only thing the
 * command exists to produce — so the exit code has to carry it. It used to
 * report "Address validation failed" and exit 0, which meant
 * `validate … && ship` shipped on an address the API had just rejected, while
 * the same script correctly halted when the API was merely unreachable. The
 * unobservable outcome was the real one.
 *
 * These tests assert the exit code rather than the message precisely because a
 * message-only assertion passes either way — which is how the bug shipped.
 */
describe('address validate exit codes', () => {
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
    if (!existsSync(testConfigDir)) mkdirSync(testConfigDir, { recursive: true });

    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === `/v1/addresses/${ADDRESS_ID}/validate`) {
          return new Response(JSON.stringify(validateResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({ error: { code: 'NOT_FOUND', message: `No route for ${url.pathname}` } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    writeFileSync(
      join(testConfigDir, 'auth.json'),
      JSON.stringify({ token: 'test-token', apiUrl: `http://localhost:${mockServer.port}` }),
    );
  });

  afterEach(() => {
    mockServer?.stop();
    mockServer = null;
    if (existsSync(testConfigDir)) rmSync(testConfigDir, { recursive: true, force: true });
  });

  test('exits 1 when the address is invalid', async () => {
    validateResponse = buildValidateResponse(false);

    const { code, errors } = await runCapturingExit(program, [
      'address', 'validate', ADDRESS_ID, '--agent', AGENT_ID,
    ]);

    expect(errors.join('\n')).toContain('Address validation failed');
    expect(code).toBe(1);
  });

  test('exits 0 when the address is valid', async () => {
    validateResponse = buildValidateResponse(true);

    const { code, logs } = await runCapturingExit(program, [
      'address', 'validate', ADDRESS_ID, '--agent', AGENT_ID,
    ]);

    expect(logs.join('\n')).toContain('Address is valid');
    // `undefined` means the handler returned without exiting — a clean 0.
    expect(code).toBeUndefined();
  });

  test('exits 1 for an invalid address in --json mode too', async () => {
    // --json used to return before the verdict was ever consulted, so the one
    // mode a script is most likely to use was the one that always said 0.
    validateResponse = buildValidateResponse(false);

    const { code, logs } = await runCapturingExit(program, [
      '--json', 'address', 'validate', ADDRESS_ID, '--agent', AGENT_ID,
    ]);

    expect(JSON.parse(logs.at(-1) as string)).toMatchObject({ valid: false });
    expect(code).toBe(1);
  });
});
