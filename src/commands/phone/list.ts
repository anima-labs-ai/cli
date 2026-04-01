import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type PhoneCapability = 'sms' | 'mms' | 'voice';

interface ListOptions {
  agent: string;
}

interface ProvisionedPhoneNumber {
  number: string;
  capabilities?: PhoneCapability[];
  provider?: string;
}

interface ListResponse {
  numbers: ProvisionedPhoneNumber[];
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

        if (response.numbers.length === 0) {
          output.info('No provisioned phone numbers found');
          return;
        }

        output.table(
          ['Number', 'Capabilities', 'Provider'],
          response.numbers.map((item) => [
            item.number,
            item.capabilities?.join(',') ?? '-',
            item.provider ?? '-',
          ]),
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
