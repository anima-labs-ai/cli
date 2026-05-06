import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../../lib/orpc.js';

export function addDomainCommand(): Command {
  return new Command('add')
    .description('Add a sending domain')
    .argument('<domain>', 'Domain name')
    .action(async function (this: Command, domain: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.domain.add({
          domain: domain.toLowerCase(),
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['ID', result.id],
          ['Domain', result.domain],
          ['Status', result.status],
          ['Verified', result.verified ? 'Yes' : 'No'],
          ['Created At', result.createdAt],
        ]);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to add domain');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else {
      output.error(`${context}: ${error.message}`);
    }
  } else if (error instanceof Error) {
    output.error(`${context}: ${error.message}`);
  } else {
    output.error(context);
  }
  process.exit(1);
}
