import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface ValidateOptions {
  agent: string;
}

interface ValidateResponse {
  valid: boolean;
  normalizedAddress: Record<string, unknown> | null;
  errors: string[];
}

export function validateAddressCommand(): Command {
  return new Command('validate')
    .description('Validate an address against postal standards')
    .argument('<id>', 'Address ID to validate')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command, addressId: string) {
      const opts = this.opts<ValidateOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const response = await client.post<ValidateResponse>(
          `/api/v1/addresses/${addressId}/validate`,
          { agentId: opts.agent },
        );

        if (globals.json) {
          output.json(response);
          return;
        }

        if (response.valid) {
          output.success('Address is valid');
        } else {
          output.error('Address validation failed');
          if (response.errors.length > 0) {
            for (const err of response.errors) {
              output.info(`  - ${err}`);
            }
          }
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to validate address: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
