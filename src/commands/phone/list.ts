import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface ListOptions {
  agent: string;
}

export function listPhoneNumbersCommand(): Command {
  return new Command('list')
    .description('List provisioned phone numbers for an agent')
    .requiredOption('--agent <id>', 'Agent ID', requireNonEmptyArg('Agent ID'))
    .action(async function (this: Command) {
      const opts = this.opts<ListOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const response = await orpc.phone.list({ agentId: opts.agent });

        if (globals.json) {
          output.json(response);
          return;
        }

        if (!response.items || response.items.length === 0) {
          output.info('No provisioned phone numbers found');
          return;
        }

        output.table(
          ['Number', 'Provider', 'Capabilities', 'Primary', 'Status'],
          response.items.map((item) => {
            const caps = [item.capabilities.sms && 'sms', item.capabilities.mms && 'mms', item.capabilities.voice && 'voice'].filter(Boolean).join(',');
            return [
              item.phoneNumber,
              item.provider,
              caps,
              item.isPrimary ? 'Yes' : 'No',
              item.tenDlcStatus,
            ];
          }),
        );
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to list phone numbers: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
