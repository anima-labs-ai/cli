import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface DeprovisionOptions {
  agent: string;
}

export function deprovisionCommand(): Command {
  return new Command('deprovision')
    .description('Deprovision vault for an agent')
    .requiredOption('--agent <id>', 'Agent ID', requireNonEmptyArg('Agent ID'))
    .action(async function (this: Command) {
      const opts = this.opts<DeprovisionOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.deprovision({ agentId: opts.agent });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Vault deprovisioned for agent ${opts.agent}`);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else {
            output.error(`Failed to deprovision vault: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to deprovision vault: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
