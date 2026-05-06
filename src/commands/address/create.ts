import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

type AddressType = 'BILLING' | 'SHIPPING' | 'MAILING' | 'REGISTERED';

interface CreateOptions {
  agent: string;
  type: string;
  label?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
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

export function createAddressCommand(): Command {
  return new Command('create')
    .description('Create an address for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .requiredOption('--type <type>', 'Address type: BILLING, SHIPPING, MAILING, REGISTERED')
    .option('--label <label>', 'Optional label for the address')
    .requiredOption('--street1 <street1>', 'Primary street address')
    .option('--street2 <street2>', 'Secondary street address (apt, suite, etc.)')
    .requiredOption('--city <city>', 'City')
    .requiredOption('--state <state>', 'State or province')
    .requiredOption('--postal-code <postalCode>', 'Postal or ZIP code')
    .requiredOption('--country <country>', 'ISO country code (e.g. US, GB)')
    .action(async function (this: Command) {
      const opts = this.opts<CreateOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const addressType = opts.type.toUpperCase();
        if (!isAddressType(addressType)) {
          throw new Error(
            `Invalid address type: ${opts.type}. Allowed values: BILLING, SHIPPING, MAILING, REGISTERED`,
          );
        }

        const orpc = await requireOrpcAuth(globals);
        const response = await orpc.address.create({
          agentId: opts.agent,
          type: addressType,
          label: opts.label,
          street1: opts.street1,
          street2: opts.street2,
          city: opts.city,
          state: opts.state,
          postalCode: opts.postalCode,
          country: opts.country.toUpperCase(),
        });

        if (globals.json) {
          output.json(response);
          return;
        }

        output.details([
          ['ID', response.id],
          ['Type', response.type],
          ['Label', response.label ?? '-'],
          ['Street', response.street2 ? `${response.street1}, ${response.street2}` : response.street1],
          ['City', response.city],
          ['State', response.state],
          ['Postal Code', response.postalCode],
          ['Country', response.country],
          ['Validated', response.validated ? 'Yes' : 'No'],
        ]);
        output.success('Address created');
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to create address: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
