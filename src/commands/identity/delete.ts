import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../lib/orpc.js';

interface DeleteIdentityOptions {
  id: string;
}

export function deleteIdentityCommand(): Command {
  return new Command('delete')
    .description('Delete an identity')
    .requiredOption('--id <id>', 'Identity ID', requireNonEmptyArg('Identity ID'))
    .action(async function (this: Command) {
      const opts = this.opts<DeleteIdentityOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.agent.delete({ id: opts.id });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Identity deleted: ${opts.id}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to delete identity', { statusMessages: { 404: 'Identity not found.' } });
      }
    });
}
