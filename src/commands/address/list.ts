import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type AddressType = 'BILLING' | 'SHIPPING' | 'MAILING' | 'REGISTERED';

interface ListOptions {
  agent: string;
  type?: string;
}

interface AddressItem {
  id: string;
  type: AddressType;
  label: string | null;
  street1: string;
  street2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  validated: boolean;
}

interface ListResponse {
  items: AddressItem[];
}

export function listAddressesCommand(): Command {
  return new Command('list')
    .description('List addresses for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .option('--type <type>', 'Filter by address type: BILLING, SHIPPING, MAILING, REGISTERED')
    .action(async function (this: Command) {
      const opts = this.opts<ListOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const query: Record<string, string> = { agentId: opts.agent };
        if (opts.type) {
          query.type = opts.type.toUpperCase();
        }

        const client = await requireAuth(globals);
        const response = await client.get<ListResponse>('/api/v1/addresses', query);

        if (globals.json) {
          output.json(response);
          return;
        }

        if (response.items.length === 0) {
          output.info('No addresses found');
          return;
        }

        output.table(
          ['ID', 'Type', 'Label', 'Street', 'City', 'State', 'Postal Code', 'Country', 'Validated'],
          response.items.map((item) => [
            item.id,
            item.type,
            item.label ?? '-',
            item.street2 ? `${item.street1}, ${item.street2}` : item.street1,
            item.city,
            item.state,
            item.postalCode,
            item.country,
            item.validated ? 'Yes' : 'No',
          ]),
        );
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list addresses: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
