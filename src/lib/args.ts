import { InvalidArgumentError } from 'commander';

/**
 * Commander argument parser rejecting a value the user never really supplied
 * — `get ""`, or a `"$ID"` that expanded to nothing.
 *
 * Commander already rejects a *missing* `<id>`, but an empty string counts as
 * supplied and reaches the action, where it collapses the request path:
 * `/webhooks/{id}` becomes `/webhooks/`, which the API resolves to the list
 * route and answers 200 with a list payload. Rendering that as a single
 * resource then failed on a missing field, surfacing a TypeError as
 * "Failed to get webhook: …" — the API blamed for a usage mistake. Read
 * commands crashed; `delete`/`send` ones reported success for an id that was
 * never sent. Rejecting the value here keeps it off the wire entirely.
 *
 * Use for arguments that name a resource by id, where empty is never
 * meaningful. Arguments whose emptiness is a server-side or domain question
 * (a search query, a config value) are not this function's business.
 */
export function requireNonEmptyArg(label: string) {
  return (value: string): string => {
    if (value.trim() === '') {
      throw new InvalidArgumentError(`${label} cannot be empty.`);
    }
    return value;
  };
}
