import { describe, test, expect } from 'bun:test';
import { InvalidArgumentError } from 'commander';
import { boundedInt, parseBoundedInt } from '../../lib/args.js';

/**
 * boundedInt and parseBoundedInt are the one bounded-integer check shared by
 * every numeric CLI flag (--limit, --max-attempts, --rate-limit-per-minute).
 * The branches below are the ones no single command test exercises on its own:
 * the parseInt trap, and the no-max "positive integer" message.
 */
describe('boundedInt (Commander-parser factory)', () => {
  test('accepts an in-range value and returns it as a number', () => {
    expect(boundedInt('limit', 1, 100)('20')).toBe(20);
  });

  test('rejects values outside [min, max] with the ranged message', () => {
    const parse = boundedInt('limit', 1, 100);
    expect(() => parse('0')).toThrow('limit must be an integer between 1 and 100');
    expect(() => parse('101')).toThrow('limit must be an integer between 1 and 100');
  });

  // The reason the check exists at all: parseInt('20abc') is 20, which would
  // silently pass a bound nobody typed. Number + isInteger rejects it.
  test('rejects trailing garbage and non-integers instead of truncating', () => {
    const parse = boundedInt('limit', 1, 100);
    expect(() => parse('20abc')).toThrow(InvalidArgumentError);
    expect(() => parse('5.5')).toThrow(InvalidArgumentError);
  });

  // No max => "positive integer", never a range that isn't enforced. This is
  // what keeps --rate-limit-per-minute's error message honest.
  test('with no max, requires a positive integer and says exactly that', () => {
    const parse = boundedInt('--rate-limit-per-minute', 1);
    expect(parse('999')).toBe(999);
    expect(() => parse('0')).toThrow('--rate-limit-per-minute must be a positive integer');
  });
});

describe('parseBoundedInt (action-body validator)', () => {
  test('returns undefined for an absent value so the caller applies its default', () => {
    expect(parseBoundedInt('--limit', undefined, 1, 50)).toBeUndefined();
  });

  test('accepts an in-range value', () => {
    expect(parseBoundedInt('--limit', '25', 1, 50)).toBe(25);
  });

  // The email-search semantic ceiling (1-50) rides on this exact message.
  test('throws InvalidArgumentError above the max', () => {
    expect(() => parseBoundedInt('--limit', '51', 1, 50)).toThrow(
      '--limit must be an integer between 1 and 50',
    );
  });

  test('rejects trailing garbage instead of truncating', () => {
    expect(() => parseBoundedInt('--limit', '20abc', 1, 50)).toThrow(InvalidArgumentError);
  });
});
