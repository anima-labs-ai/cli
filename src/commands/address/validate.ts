import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { requireNonEmptyArg } from '../../lib/args.js';

interface ValidateOptions {
  agent: string;
}

export function validateAddressCommand(): Command {
  return new Command('validate')
    .description(
      'Validate one specific address against postal standards. ' +
        'Validates a single address by its ID — not all addresses for an agent. ' +
        'Find an address ID with `am address list --agent <agentId>`.',
    )
    .argument(
      '<addressId>',
      'ID of the address to validate (e.g. addr_xxx). Run `am address list --agent <agentId>` to find one.',
      requireNonEmptyArg('Address ID'),
    )
    .requiredOption('--agent <agentId>', 'Agent that owns the address')
    .addHelpText(
      'after',
      `
Examples:
  $ am address list --agent agt_xxx          # find your address ids
  $ am address validate addr_yyy --agent agt_xxx
`,
    )
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
        } else if (response.valid) {
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

        // The verdict is this command's whole contract, so it decides the exit
        // — after rendering, and regardless of --json. Reporting "validation
        // failed" and exiting 0 let `validate … && ship` ship an address the
        // API rejected, while the same script correctly halted when the API was
        // merely down. Matches `doctor`, which exits on the verdict, not the
        // format.
        if (!response.valid) process.exit(1);
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
