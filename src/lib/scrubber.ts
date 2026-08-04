/**
 * Scrubber: replace any occurrence of known-secret values in a stream chunk
 * with "[REDACTED]" before the chunk reaches the parent's stdout/stderr.
 *
 * This is the last line of defense when a child process (e.g. a script invoked
 * via `am vault exec`) accidentally logs a secret. Without scrubbing, any
 * `console.log(process.env.STRIPE_KEY)` in the child would leak the secret to
 * the terminal — and from there, often to CI logs, screen-recordings, and the
 * LLM reading the terminal.
 *
 * ## Policy: always strip
 *
 * Scrubbing is unconditional and there is no opt-out. `--no-scrub` used to
 * exist as an escape hatch for the case where the scrubber redacted output
 * that coincidentally contained a secret substring, but it also made
 * `am vault exec --no-scrub --cred X --as V -- sh -c 'echo $V'` a one-line
 * plaintext read: the property that an agent can use a secret without seeing
 * it was opt-out by a single flag. The diagnostic case is not worth that, so
 * the flag is gone.
 *
 * This is stricter than 1Password's `op run` (scrub on, opt-out available)
 * and far stricter than Doppler's `doppler run` (scrub off by default).
 *
 * ## Performance notes
 *
 * `applyScrub` is on the hot path for child stdout/stderr. Worst-case cost is
 * O(chunk_bytes × num_secrets). We keep this fast by:
 *
 *   1. Deduping identical values once at policy-build time (not per chunk).
 *   2. Filtering by `minLength` before the string scan (short values are
 *      skipped: too many false positives, not enough entropy).
 *   3. Sorting longest-first so "sk_live_abc123def" is replaced before
 *      "sk_live_abc" — otherwise a short prefix would redact the suffix.
 *   4. Using `String.prototype.split(literal).join(replacement)` which is a
 *      single linear pass per literal and avoids regex overhead.
 *
 * A typical `am vault exec` loads ~5 secrets; cost is negligible for normal
 * CLI output volumes.
 */

export interface ScrubPolicy {
  /** Substrings that must be replaced wherever they appear. */
  literals: string[];
  /** Replacement string (default "[REDACTED]"). */
  replacement: string;
  /** Minimum length — values shorter than this are NOT scrubbed (too many false positives). */
  minLength: number;
}

export function applyScrub(chunk: Buffer, policy: ScrubPolicy): Buffer {
  if (policy.literals.length === 0) return chunk;
  let text = chunk.toString('utf-8');
  for (const literal of policy.literals) {
    // `includes` before split avoids allocating a fresh array for the common
    // no-match case — a meaningful speedup when the chunk contains zero hits.
    if (text.includes(literal)) {
      text = text.split(literal).join(policy.replacement);
    }
  }
  return Buffer.from(text, 'utf-8');
}

/**
 * Build the scrub policy used by `am vault exec`.
 *
 * Every resolved secret value (of length >= minLength, deduped) becomes a
 * literal that `applyScrub` will redact from the child's stdout/stderr.
 *
 * The caller is responsible for plumbing the resolved values in and wiring
 * the returned policy into the child's stdio pipes.
 */
export function buildScrubPolicy(resolvedValues: Record<string, string>): ScrubPolicy {
  const minLength = 8;
  // Dedupe — two env vars may map to the same value; scrubbing each independently
  // would do duplicate work on every chunk.
  const deduped = new Set<string>();
  for (const value of Object.values(resolvedValues)) {
    if (typeof value === 'string' && value.length >= minLength) {
      deduped.add(value);
    }
  }

  // Longest-first so prefix overlaps don't leak the suffix.
  // (e.g. secrets ["sk_live_abc", "sk_live_abc123def"] — replace the longer
  // string first, otherwise after replacing "sk_live_abc" the suffix "123def"
  // would slip through.)
  const literals = [...deduped].sort((a, b) => b.length - a.length);

  return {
    literals,
    replacement: '[REDACTED]',
    minLength,
  };
}
