import { InvalidArgumentError } from 'commander';

/**
 * Commander parser rejecting a value the user never really supplied — `get ""`,
 * or a `"$ID"` that expanded to nothing. Works for both a positional
 * (`.argument('<id>', 'Draft ID', requireNonEmptyArg('Draft ID'))`) and an
 * option (`.requiredOption('--id <id>', 'Identity ID', …)`).
 *
 * Commander already rejects a *missing* `<id>`, but an empty string counts as
 * supplied and reaches the action, where it collapses the request path:
 * `/webhooks/{id}` becomes `/webhooks/`, which the API resolves to the list
 * route and answers 200 with a list payload. Rendering that as a single
 * resource then failed on a missing field, surfacing a TypeError as
 * "Failed to get webhook: …" — the API blamed for a usage mistake. Read
 * commands crashed; destructive ones were worse, reporting `Identity deleted: `
 * and exiting 0 for an id that was never sent. Rejecting the value here keeps
 * it off the wire entirely, and Commander reports it in the same shape as any
 * other usage error.
 *
 * Use for inputs that name a resource by id, where empty is never meaningful.
 * Inputs whose emptiness is a server-side or domain question (a search query, a
 * config value) are not this function's business.
 *
 * Whitespace-only is rejected but a padded value is passed through unchanged:
 * `"   "` is a value nobody meant to supply, while `" abc "` was supplied and
 * is simply wrong, and silently rewriting what the user typed would hide that.
 * It reaches the API and earns an honest 404.
 */
export function requireNonEmptyArg(label: string) {
  return (value: string): string => {
    if (value.trim() === '') {
      throw new InvalidArgumentError(`${label} cannot be empty.`);
    }
    return value;
  };
}

/**
 * Commander parser for `--limit`, the page size on every paginated list and
 * search command.
 *
 * The 1-100 bound is not a taste call: it mirrors the contract's `Pagination`
 * schema (`limit: z.number().int().min(1).max(100).default(20)`). Widening it
 * here would only move the rejection to the server.
 *
 * `Number`, not `parseInt` — `parseInt('20abc')` is `20`, so a fat-fingered
 * limit would silently page at a size nobody asked for.
 *
 * Returns the value unparsed. Call sites type `limit?: string` and convert at
 * the request boundary (`opts.limit ? Number(opts.limit) : undefined`), so
 * returning a number here would ripple into every action body.
 *
 * Not a factory, unlike its neighbour above: every call site wants exactly
 * these bounds and this message, so there is nothing to parameterise. A limit
 * with different bounds is a different rule, not a configuration of this one.
 */
export function validateLimit(value: string): string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError('limit must be an integer between 1 and 100');
  }
  return value;
}

/**
 * The one bounded-integer check behind both numeric-arg helpers below.
 *
 * `Number`, not `parseInt` — `parseInt('20abc')` is `20`, so a fat-fingered
 * value would silently pass at a bound nobody typed. `max` is optional: an
 * omitted ceiling means "positive integer, no upper bound" (a rate limit, a
 * TTL), and the message adapts so it never claims a range that isn't enforced.
 */
function checkBoundedInt(label: string, value: string, min: number, max?: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    const requirement =
      max !== undefined
        ? `an integer between ${min} and ${max}`
        : min === 1
          ? 'a positive integer'
          : `an integer >= ${min}`;
    throw new InvalidArgumentError(`${label} must be ${requirement}`);
  }
  return parsed;
}

/**
 * Commander parser factory for a bounded-integer option — the parse-time twin
 * of [[parseBoundedInt]], for flags whose bounds are fixed and known upfront:
 * `.option('--max-attempts <n>', '…', boundedInt('--max-attempts', 1, 10))`.
 * Omit `max` for an open-ended positive integer (a rate limit). Returns the
 * parsed number, so the call site's options type is `number`, not the raw
 * string.
 */
export function boundedInt(label: string, min: number, max?: number) {
  return (value: string): number => checkBoundedInt(label, value, min, max);
}

/**
 * Validate a bounded integer from *inside an action body*, for the cases a
 * Commander parser can't cover: `email search`'s `--limit` ceiling is 100 in
 * full-text mode but 50 with `--semantic`, and that mode isn't known when
 * Commander parses the flag. Returns `undefined` for an absent value so the
 * caller applies its own default (`?? 20`); throws InvalidArgumentError, which
 * the command's own catch renders as a usage error.
 */
export function parseBoundedInt(
  flag: string,
  value: string | undefined,
  min: number,
  max: number,
): number | undefined {
  return value === undefined ? undefined : checkBoundedInt(flag, value, min, max);
}

/**
 * Commander reducer for a repeatable string option — `--label a --label b`
 * accumulates into `['a', 'b']`. Pair it with a `[]` default:
 * `.option('--label <label>', '…', collectValue, [])`.
 *
 * The same append-on-repeat shape the CLI already uses for `--to`/`--cc` on
 * `email send`. Hoisted here (rather than re-declared per command) so every
 * repeatable flag accumulates identically instead of one command silently
 * keeping only the last value.
 */
export function collectValue(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
