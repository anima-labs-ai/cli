import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface UsageOptions {
  id: string;
}

export function podUsageCommand(): Command {
  return new Command('usage')
    .description('Get resource usage for a pod')
    .requiredOption('--id <id>', 'Pod ID')
    .action(async function (this: Command) {
      const opts = this.opts<UsageOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const usage = await orpc.pod.usage({ id: opts.id });

        if (globals.json) {
          output.json(usage);
          return;
        }

        output.details([
          ['Agents', String(usage.agentCount)],
          ['Emails', String(usage.emailCount)],
          ['Phones', String(usage.smsCount)],
          ['Vault Items', String(usage.vaultCount)],
          ['Addresses', String(usage.addressCount)],
        ]);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to get pod usage');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Pod not found.');
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
