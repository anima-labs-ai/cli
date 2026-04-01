import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

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

interface AddressResponse {
  id: string;
  agentId: string;
  type: AddressType;
  label: string | null;
  street1: string;
  street2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  validated: boolean;
  createdAt: string;
  updatedAt: string;
}

const VALID_TYPES: ReadonlySet<string> = new Set(['BILLING', 'SHIPPING', 'MAILING', 'REGISTERED']);

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
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const addressType = opts.type.toUpperCase();
        if (!VALID_TYPES.has(addressType)) {
          throw new Error(`Invalid address type: ${opts.type}. Allowed values: BILLING, SHIPPING, MAILING, REGISTERED`);
        }

        const body: Record<string, string> = {
          agentId: opts.agent,
          type: addressType,
          street1: opts.street1,
          city: opts.city,
          state: opts.state,
          postalCode: opts.postalCode,
          country: opts.country.toUpperCase(),
        };

        if (opts.label) {
          body.label = opts.label;
        }
        if (opts.street2) {
          body.street2 = opts.street2;
        }

        const client = await requireAuth(globals);
        const response = await client.post<AddressResponse>('/addresses', body);

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
        if (error instanceof ApiError) {
          output.error(`Failed to create address: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
