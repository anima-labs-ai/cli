import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { parseBoundedInt } from '../../lib/args.js';

type PhoneCapability = 'sms' | 'mms' | 'voice';

interface SearchOptions {
  country?: string;
  areaCode?: string;
  capabilities?: string;
  limit?: string;
}

function parseCapabilities(input?: string): PhoneCapability[] | undefined {
  if (!input) {
    return undefined;
  }

  const capabilities = input
    .split(',')
    .map((capability) => capability.trim().toLowerCase())
    .filter((capability) => capability.length > 0);

  if (capabilities.length === 0) {
    return undefined;
  }

  const uniqueCapabilities = [...new Set(capabilities)];
  const allowedCapabilities: ReadonlySet<string> = new Set(['sms', 'mms', 'voice']);

  for (const capability of uniqueCapabilities) {
    if (!allowedCapabilities.has(capability)) {
      throw new Error(`Invalid capability: ${capability}. Allowed values: sms,mms,voice`);
    }
  }

  return uniqueCapabilities as PhoneCapability[];
}

function normalizeCountryCode(input?: string): string {
  const country = (input ?? 'US').trim().toUpperCase();
  if (country.length !== 2) {
    throw new Error('Invalid --country. Must be a 2-character country code');
  }

  return country;
}

export function searchPhoneNumbersCommand(): Command {
  return new Command('search')
    .description('Search available phone numbers')
    .option('--country <countryCode>', 'Country code (2 chars)', 'US')
    .option('--area-code <areaCode>', 'Area code filter')
    .option('--capabilities <capabilities>', 'Comma-separated capabilities: sms,mms,voice')
    .option('--limit <limit>', 'Result limit (1-50)')
    .action(async function (this: Command) {
      const opts = this.opts<SearchOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const countryCode = normalizeCountryCode(opts.country);
        const capabilities = parseCapabilities(opts.capabilities);
        const limit = parseBoundedInt('--limit', opts.limit, 1, 50) ?? 10;

        const input: {
          countryCode: string;
          limit: number;
          areaCode?: string;
          capabilities?: PhoneCapability[];
        } = {
          countryCode,
          limit,
        };

        if (opts.areaCode) {
          input.areaCode = opts.areaCode;
        }
        if (capabilities && capabilities.length > 0) {
          input.capabilities = capabilities;
        }

        const orpc = await requireOrpcAuth(globals);
        const response = await orpc.phone.search(input);

        if (globals.json) {
          output.json(response);
          return;
        }

        const items = response.items ?? [];
        const headers = ['Number', 'Capabilities', 'Region'];
        const rows = items.map((item) => {
          const caps = item.capabilities
            ? [item.capabilities.sms && 'sms', item.capabilities.mms && 'mms', item.capabilities.voice && 'voice']
                .filter(Boolean)
                .join(',')
            : '-';
          return [item.phoneNumber, caps, item.region ?? '-'];
        });

        output.table(headers, rows, {
          summary: items.length === 0 ? 'No available numbers found' : `Returned ${items.length} numbers`,
        });
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to search phone numbers: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
