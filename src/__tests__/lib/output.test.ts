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
      const output = new Output({ json: false, debug: false });
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
      const spy = mock(() => {});
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
      const spy = mock(() => {});
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
      const spy = mock(() => {});
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
      const output = new Output({ json: false, debug: false });
      const spy = mock(() => {});
      const originalLog = console.log;
      console.log = spy;

      output.success('all good');

      console.log = originalLog;
      expect(spy).toHaveBeenCalled();
      const printed = spy.mock.calls[0][0] as string;
      expect(printed).toContain('all good');
    });

    test('error prints to stderr', () => {
      const output = new Output({ json: false, debug: false });
      const spy = mock(() => {});
      const originalError = console.error;
      console.error = spy;

      output.error('bad thing');

      console.error = originalError;
      expect(spy).toHaveBeenCalled();
      const printed = spy.mock.calls[0][0] as string;
      expect(printed).toContain('bad thing');
    });

    test('warn prints warning', () => {
      const output = new Output({ json: false, debug: false });
      const spy = mock(() => {});
      const originalLog = console.log;
      console.log = spy;

      output.warn('be careful');

      console.log = originalLog;
      expect(spy).toHaveBeenCalled();
      const printed = spy.mock.calls[0][0] as string;
      expect(printed).toContain('be careful');
    });

    test('info prints info message', () => {
      const output = new Output({ json: false, debug: false });
      const spy = mock(() => {});
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
      const output = new Output({ json: false, debug: false });
      const spy = mock(() => {});
      const originalLog = console.log;
      console.log = spy;

      output.debug('hidden message');

      console.log = originalLog;
      expect(spy).not.toHaveBeenCalled();
    });

    test('shows debug output when debug mode on', () => {
      const output = new Output({ json: false, debug: true });
      const spy = mock(() => {});
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
      const spy = mock(() => {});
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
      const output = new Output({ json: false, debug: false });
      const spy = mock(() => {});
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
      const spy = mock(() => {});
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
});
