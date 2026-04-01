import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type PhoneCapability = 'sms' | 'mms' | 'voice';

interface SearchOptions {
  country?: string;
  areaCode?: string;
  capabilities?: string;
  limit?: string;
}

interface SearchPhoneNumber {
  phoneNumber: string;
  region?: string;
  capabilities?: { sms: boolean; mms: boolean; voice: boolean };
  monthlyCost?: number;
}

interface SearchResponse {
  items: SearchPhoneNumber[];
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

function parseLimit(input?: string): string {
  if (!input) {
    return '10';
  }

  const parsed = Number.parseInt(input, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new Error('Invalid --limit. Must be an integer between 1 and 50');
  }

  return String(parsed);
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
    .option('--limit <limit>', 'Result limit (1-50)', '10')
    .action(async function (this: Command) {
      const opts = this.opts<SearchOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const countryCode = normalizeCountryCode(opts.country);
        const capabilities = parseCapabilities(opts.capabilities);
        const limit = parseLimit(opts.limit);

        const params = new URLSearchParams();
        params.set('countryCode', countryCode);
        params.set('limit', limit);
        if (opts.areaCode) {
          params.set('areaCode', opts.areaCode);
        }
        if (capabilities && capabilities.length > 0) {
          for (const cap of capabilities) {
            params.append('capabilities[]', cap);
          }
        }

        const client = await requireAuth(globals);
        const response = await client.get<SearchResponse>(`/phone/search?${params}`);

        if (globals.json) {
          output.json(response);
          return;
        }

        if (!response.items || response.items.length === 0) {
          output.info('No available numbers found');
          return;
        }

        output.table(
          ['Number', 'Capabilities', 'Region'],
          response.items.map((item) => {
            const caps = item.capabilities
              ? [item.capabilities.sms && 'sms', item.capabilities.mms && 'mms', item.capabilities.voice && 'voice'].filter(Boolean).join(',')
              : '-';
            return [
              item.phoneNumber,
              caps,
              item.region ?? '-',
            ];
          }),
        );
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to search phone numbers: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
