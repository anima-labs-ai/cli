import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../../lib/orpc.js';

export function listDomainsCommand(): Command {
  return new Command('list')
    .description('List sending domains')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.domain.list({});

        if (globals.json) {
          output.json(result);
          return;
        }

        const items = result.items ?? [];
        if (items.length === 0) {
          output.info('No domains found');
          return;
        }

        output.table(
          ['ID', 'Domain', 'Status', 'Verified', 'Created At'],
          items.map((domain) => [
            domain.id,
            domain.domain,
            domain.status,
            domain.verified ? 'Yes' : 'No',
            domain.createdAt,
          ]),
        );
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to list domains');
      }
    });
}
