import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { Output } from '../../lib/output.js';

describe('Output', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    consoleOutput = [];
    mock.module('ora', () => ({
      default: () => ({
        start: () => ({ stop: () => {}, succeed: () => {}, fail: () => {} }),
      }),
    }));
  });

  describe('constructor', () => {
    test('creates with default options', () => {
      const output = new Output({ human: true, debug: false });
      expect(output).toBeDefined();
    });

    test('creates with json mode', () => {
      const output = new Output({ json: true, debug: false });
      expect(output).toBeDefined();
    });
  });

  describe('json mode output', () => {
    test('success outputs JSON when json mode enabled', () => {
      const output = new Output({ json: true, debug: false });
      const spy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = spy;

      output.success('test message');

      console.log = originalLog;
      expect(spy).toHaveBeenCalled();
      const call = spy.mock.calls[0];
      const parsed = JSON.parse(call[0] as string);
      expect(parsed.status).toBe('success');
      expect(parsed.message).toBe('test message');
    });

    test('error outputs JSON when json mode enabled', () => {
      const output = new Output({ json: true, debug: false });
      const spy = mock((...args: unknown[]) => {});
      const originalError = console.error;
      console.error = spy;

      output.error('error message');

      console.error = originalError;
      expect(spy).toHaveBeenCalled();
      const call = spy.mock.calls[0];
      const parsed = JSON.parse(call[0] as string);
      expect(parsed.status).toBe('error');
      expect(parsed.message).toBe('error message');
    });

    test('json() outputs serialized JSON', () => {
      const output = new Output({ json: true, debug: false });
      const spy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = spy;

      const data = { id: '123', name: 'test' };
      output.json(data);

      console.log = originalLog;
      expect(spy).toHaveBeenCalled();
      const call = spy.mock.calls[0];
      const parsed = JSON.parse(call[0] as string);
      expect(parsed.id).toBe('123');
      expect(parsed.name).toBe('test');
    });
  });

  describe('human mode output', () => {
    test('success prints colored message', () => {
      const output = new Output({ human: true, debug: false });
      const spy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = spy;

      output.success('all good');

      console.log = originalLog;
      expect(spy).toHaveBeenCalled();
      const printed = spy.mock.calls[0][0] as string;
      expect(printed).toContain('all good');
    });

    test('error prints to stderr', () => {
      const output = new Output({ human: true, debug: false });
      const spy = mock((...args: unknown[]) => {});
      const originalError = console.error;
      console.error = spy;

      output.error('bad thing');

      console.error = originalError;
      expect(spy).toHaveBeenCalled();
      const printed = spy.mock.calls[0][0] as string;
      expect(printed).toContain('bad thing');
    });

    test('warn prints warning', () => {
      const output = new Output({ human: true, debug: false });
      const spy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = spy;

      output.warn('be careful');

      console.log = originalLog;
      expect(spy).toHaveBeenCalled();
      const printed = spy.mock.calls[0][0] as string;
      expect(printed).toContain('be careful');
    });

    test('info prints info message', () => {
      const output = new Output({ human: true, debug: false });
      const spy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = spy;

      output.info('fyi');

      console.log = originalLog;
      expect(spy).toHaveBeenCalled();
      const printed = spy.mock.calls[0][0] as string;
      expect(printed).toContain('fyi');
    });
  });

  describe('debug', () => {
    test('suppresses debug output when debug mode off', () => {
      const output = new Output({ human: true, debug: false });
      const spy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = spy;

      output.debug('hidden message');

      console.log = originalLog;
      expect(spy).not.toHaveBeenCalled();
    });

    test('shows debug output when debug mode on', () => {
      const output = new Output({ json: false, debug: true });
      const spy = mock((...args: unknown[]) => {});
      const originalError = console.error;
      console.error = spy;

      output.debug('visible message');

      console.error = originalError;
      expect(spy).toHaveBeenCalled();
      const printed = spy.mock.calls[0][0] as string;
      expect(printed).toContain('visible message');
    });
  });

  describe('table', () => {
    test('outputs JSON array in json mode', () => {
      const output = new Output({ json: true, debug: false });
      const spy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = spy;

      output.table(['Name', 'Email'], [['Alice', 'alice@test.com'], ['Bob', 'bob@test.com']]);

      console.log = originalLog;
      expect(spy).toHaveBeenCalled();
      const call = spy.mock.calls[0];
      const parsed = JSON.parse(call[0] as string);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('Alice');
      expect(parsed[0].email).toBe('alice@test.com');
    });

    test('outputs formatted table in human mode', () => {
      const output = new Output({ human: true, debug: false });
      const spy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = spy;

      output.table(['ID', 'Status'], [['1', 'active']]);

      console.log = originalLog;
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('details', () => {
    test('outputs JSON object in json mode', () => {
      const output = new Output({ json: true, debug: false });
      const spy = mock((...args: unknown[]) => {});
      const originalLog = console.log;
      console.log = spy;

      output.details([['Name', 'Test'], ['Status', 'active']]);

      console.log = originalLog;
      expect(spy).toHaveBeenCalled();
      const call = spy.mock.calls[0];
      const parsed = JSON.parse(call[0] as string);
      expect(parsed.name).toBe('Test');
      expect(parsed.status).toBe('active');
    });
  });

  describe('spinner', () => {
    test('returns null in json mode', () => {
      const output = new Output({ json: true, debug: false });
      const spinner = output.spinner('loading...');
      expect(spinner).toBeNull();
    });
  });

  describe('fatal', () => {
    // Capture what fatal() writes to stderr and the code it exits with, without
    // letting process.exit actually tear down the test runner.
    function runFatal(
      output: Output,
      message: string,
      code?: number,
    ): { stderr: string[]; exitCode: number | undefined } {
      const errSpy = mock(() => {});
      const originalError = console.error;
      const originalExit = process.exit;
      let exitCode: number | undefined;
      console.error = errSpy;
      process.exit = ((c?: number) => {
        exitCode = c;
      }) as unknown as typeof process.exit;
      // Cast away the `never` return: in tests process.exit is a no-op, so
      // fatal() actually falls through here — without the cast TS would (rightly
      // for production) flag the restore/return below as unreachable. Passing an
      // undefined `code` exercises fatal()'s default of 1.
      const callFatal = output.fatal.bind(output) as (m: string, c?: number) => void;
      try {
        callFatal(message, code);
      } finally {
        console.error = originalError;
        process.exit = originalExit;
      }
      return {
        stderr: errSpy.mock.calls.map((call) => String(call.at(0))),
        exitCode,
      };
    }

    // Same helper for error(), so the two can be compared directly.
    function runError(output: Output, message: string): string[] {
      const errSpy = mock(() => {});
      const originalError = console.error;
      console.error = errSpy;
      try {
        output.error(message);
      } finally {
        console.error = originalError;
      }
      return errSpy.mock.calls.map((call) => String(call.at(0)));
    }

    // The whole point of fatal() is that it CANNOT print an error and then
    // leave the process to exit 0 — a green exit after a `{"status":"error"}`
    // payload is the bug PR #23 chased across 8 sites. Prove the exit happens.
    test('exits non-zero after reporting', () => {
      const output = new Output({ format: 'agent', debug: false });
      const { exitCode } = runFatal(output, 'boom');
      expect(exitCode).toBe(1);
    });

    test('defaults to exit code 1', () => {
      const output = new Output({ format: 'agent', debug: false });
      expect(runFatal(output, 'boom').exitCode).toBe(1);
    });

    test('honors an explicit exit code (2 = bad input)', () => {
      const output = new Output({ format: 'agent', debug: false });
      expect(runFatal(output, 'bad flag', 2).exitCode).toBe(2);
    });

    test('honors an arbitrary exit code (e.g. 127)', () => {
      const output = new Output({ format: 'agent', debug: false });
      expect(runFatal(output, 'spawn failed', 127).exitCode).toBe(127);
    });

    // The migration is only safe if fatal() renders EXACTLY as error() did —
    // callers and golden snapshots depend on the per-format
    // {"status":"error","message":...} contract. Lock that equivalence in for
    // every format so the two implementations can never drift.
    const FORMATS = ['agent', 'json', 'yaml', 'jsonl', 'md', 'human'] as const;
    for (const format of FORMATS) {
      test(`renders identically to error() in ${format} format`, () => {
        const message = 'something broke';
        const fatalOut = runFatal(
          new Output({ format, debug: false }),
          message,
        ).stderr;
        const errorOut = runError(new Output({ format, debug: false }), message);
        expect(fatalOut).toEqual(errorOut);
        // And it is the error channel (stderr), never stdout.
        expect(fatalOut.length).toBeGreaterThan(0);
      });
    }
  });
});
