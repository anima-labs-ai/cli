import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { requireNonEmptyArg } from '../../lib/args.js';

interface DeleteOptions {
  agent?: string;
}

export function deleteCommand(): Command {
  return new Command('delete')
    .description('Delete credential')
    .argument('<credentialId>', 'Credential ID', requireNonEmptyArg('Credential ID'))
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .action(async function (this: Command, credentialId: string) {
      const opts = this.opts<DeleteOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.delete({ id: credentialId, agentId: opts.agent });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Deleted credential ${credentialId}`);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else if (error.status === 404) {
            output.error('Credential not found.');
          } else {
            output.error(`Failed to delete credential: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to delete credential: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
