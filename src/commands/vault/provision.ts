import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface ProvisionOptions {
  agent: string;
}

export function provisionCommand(): Command {
  return new Command('provision')
    .description('Provision vault for an agent')
    .requiredOption('--agent <id>', 'Agent ID', requireNonEmptyArg('Agent ID'))
    .action(async function (this: Command) {
      const opts = this.opts<ProvisionOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.provision({ agentId: opts.agent });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Vault provisioned for agent ${opts.agent}`);
        output.details([
          ['Vault ID', result.id],
          ['Agent ID', result.agentId],
          ['Organization ID', result.orgId],
          ['Status', result.status],
          ['Credential Count', String(result.credentialCount)],
          ['Last Sync', result.lastSyncAt ?? 'Never'],
        ]);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else {
            output.error(`Failed to provision vault: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to provision vault: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
