import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import type { GlobalOptions } from '../../lib/auth.js';
import { resolveConfigValue } from '../../lib/config.js';
import { handleOrpcError, requireOrpcAuth } from '../../lib/orpc.js';
import { Output } from '../../lib/output.js';

interface UsageOptions {
  org?: string;
}

/**
 * `am admin usage`.
 *
 * Was `GET /v1/admin/orgs/{org}/usage`, which answered "Route not found" —
 * there is no `/v1/admin/*` namespace in the API. Now reads `/orgs/me/usage`,
 * which is explicitly "callable by any authenticated credential — scoped to
 * the caller's org", so this works with the agent key `am init` stores rather
 * than needing a master key it never had.
 *
 * `--org` is consequently no longer required, and cannot select a different
 * org: the endpoint derives the org from the credential. It is kept only so
 * an existing script passing its own org keeps working, and is rejected when
 * it names some other org rather than being silently ignored.
 */
export function usageCommand(): Command {
  return new Command('usage')
    .description('Show usage summary for the current billing period')
    .option(
      '--org <org>',
      'Organization ID (must be the org this credential belongs to)',
      requireNonEmptyArg('Organization ID'),
    )
    .action(async function (this: Command) {
      const opts = this.opts<UsageOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output: Output = Output.fromGlobals(globals);

      // Checked before the try, not inside it: this is a usage error, and a
      // `fatal` raised inside the block below would be caught by the same
      // handler that renders API failures, which rewrites the exit code and
      // reports a bad flag as a request that failed.
      if (opts.org !== undefined) {
        const scoped = await resolveConfigValue('defaultOrg');
        if (scoped !== undefined && opts.org !== scoped) {
          output.fatal(
            `This credential is scoped to ${scoped}, so usage for ${opts.org} cannot be read. ` +
              'Sign in with `am auth login` to reach other orgs you belong to.',
            2,
          );
        }
      }

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.org.usageOverview({});

        if (globals.json) {
          output.json(result);
          return;
        }

        // `totals` is an open record of counters rather than the fixed
        // identities/emails/storage triple this command used to print, so
        // render whatever the period actually reported.
        const totals = Object.entries(result.totals ?? {});
        output.details([
          ['Period', result.period],
          ['Updated', result.updatedAt ?? 'never — no usage recorded yet'],
          ...totals.map(([name, value]): [string, string] => [name, String(value)]),
        ]);
        if (totals.length === 0) {
          output.info('No counters recorded for this period yet.');
        }
      } catch (err: unknown) {
        handleOrpcError(err, output, 'Failed to read usage');
      }
    });
}
