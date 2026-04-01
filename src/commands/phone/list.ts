import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type PhoneCapability = 'sms' | 'mms' | 'voice';

interface ListOptions {
  agent: string;
}

interface ProvisionedPhoneNumber {
  id: string;
  phoneNumber: string;
  provider: string;
  capabilities: { sms: boolean; mms: boolean; voice: boolean };
  isPrimary: boolean;
  tenDlcStatus: string;
}

interface ListResponse {
  items: ProvisionedPhoneNumber[];
}

export function listPhoneNumbersCommand(): Command {
  return new Command('list')
    .description('List provisioned phone numbers for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<ListOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const response = await client.get<ListResponse>('/phone/numbers', { agentId: opts.agent });

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
        if (error instanceof ApiError) {
          output.error(`Failed to list phone numbers: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
