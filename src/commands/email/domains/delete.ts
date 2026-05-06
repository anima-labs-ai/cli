import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../../lib/orpc.js';

export function deleteDomainCommand(): Command {
  return new Command('delete')
    .description('Delete a sending domain')
    .argument('<id>', 'Domain ID')
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.domain.delete({ id });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Deleted domain ${id}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to delete domain');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Domain not found.');
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
