import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type PhoneCapability = 'sms' | 'mms' | 'voice';

interface ProvisionOptions {
  agent: string;
  country?: string;
  areaCode?: string;
  capabilities?: string;
}

interface ProvisionResponse {
  number: string;
  capabilities?: PhoneCapability[];
  provider?: string;
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

export function provisionPhoneNumberCommand(): Command {
  return new Command('provision')
    .description('Provision a phone number for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .option('--country <countryCode>', 'Country code (2 chars)', 'US')
    .option('--area-code <areaCode>', 'Area code preference')
    .option('--capabilities <capabilities>', 'Comma-separated capabilities: sms,mms,voice')
    .action(async function (this: Command) {
      const opts = this.opts<ProvisionOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const countryCode = normalizeCountryCode(opts.country);
        const capabilities = parseCapabilities(opts.capabilities);

        const body: {
          agentId: string;
          countryCode: string;
          areaCode?: string;
          capabilities?: PhoneCapability[];
        } = {
          agentId: opts.agent,
          countryCode,
        };

        if (opts.areaCode) {
          body.areaCode = opts.areaCode;
        }
        if (capabilities && capabilities.length > 0) {
          body.capabilities = capabilities;
        }

        const client = await requireAuth(globals);
        const response = await client.post<ProvisionResponse>('/phone/provision', body);

        if (globals.json) {
          output.json(response);
          return;
        }

        output.details([
          ['Number', response.number],
          ['Capabilities', response.capabilities?.join(',') ?? '-'],
          ['Provider', response.provider ?? '-'],
        ]);
        output.success('Phone number provisioned');
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to provision phone number: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
