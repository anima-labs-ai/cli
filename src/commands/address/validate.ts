import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface ValidateOptions {
  agent: string;
}

export function validateAddressCommand(): Command {
  return new Command('validate')
    .description('Validate an address against postal standards')
    .argument('<id>', 'Address ID to validate')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command, addressId: string) {
      const opts = this.opts<ValidateOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const response = await orpc.address.validate({
          id: addressId,
          agentId: opts.agent,
        });

        if (globals.json) {
          output.json(response);
          return;
        }

        if (response.valid) {
          output.success('Address is valid');
        } else {
          output.error('Address validation failed');
          if (response.suggestions.length > 0) {
            for (const suggestion of response.suggestions) {
              const street = suggestion.street2
                ? `${suggestion.street1}, ${suggestion.street2}`
                : suggestion.street1;
              output.info(
                `  - ${street}, ${suggestion.city}, ${suggestion.state} ${suggestion.postalCode} ${suggestion.country}`,
              );
            }
          }
        }
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to validate address: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
