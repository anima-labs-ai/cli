import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

type AddressType = 'BILLING' | 'SHIPPING' | 'MAILING' | 'REGISTERED';

interface ListOptions {
  agent: string;
  type?: string;
}

const VALID_TYPES: ReadonlySet<AddressType> = new Set<AddressType>([
  'BILLING',
  'SHIPPING',
  'MAILING',
  'REGISTERED',
]);

function isAddressType(value: string): value is AddressType {
  return (VALID_TYPES as ReadonlySet<string>).has(value);
}

export function listAddressesCommand(): Command {
  return new Command('list')
    .description('List addresses for an agent')
    .requiredOption('--agent <id>', 'Agent ID', requireNonEmptyArg('Agent ID'))
    .option('--type <type>', 'Filter by address type: BILLING, SHIPPING, MAILING, REGISTERED')
    .action(async function (this: Command) {
      const opts = this.opts<ListOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        let typeFilter: AddressType | undefined;
        if (opts.type) {
          const upper = opts.type.toUpperCase();
          if (!isAddressType(upper)) {
            throw new Error(
              `Invalid address type: ${opts.type}. Allowed values: BILLING, SHIPPING, MAILING, REGISTERED`,
            );
          }
          typeFilter = upper;
        }

        const orpc = await requireOrpcAuth(globals);
        const items = await orpc.address.list({
          agentId: opts.agent,
          type: typeFilter,
        });

        if (globals.json) {
          output.json(items);
          return;
        }

        if (items.length === 0) {
          output.info('No addresses found');
          return;
        }

        output.table(
          ['ID', 'Type', 'Label', 'Street', 'City', 'State', 'Postal Code', 'Country', 'Validated'],
          items.map((item) => [
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
        if (error instanceof ORPCError) {
          output.error(`Failed to list addresses: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
