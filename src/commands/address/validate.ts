import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { requireNonEmptyArg } from '../../lib/args.js';
import { resolveAgentId } from '../../lib/agent.js';

interface ValidateOptions {
  agent?: string;
}

interface AddressSuggestion {
  street1: string;
  street2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

/** One suggestion on one line, for the human rendering. Machine callers get
 *  the structured suggestion objects untouched. */
function formatSuggestion(suggestion: AddressSuggestion): string {
  const street = suggestion.street2
    ? `${suggestion.street1}, ${suggestion.street2}`
    : suggestion.street1;
  return `${street}, ${suggestion.city}, ${suggestion.state} ${suggestion.postalCode} ${suggestion.country}`;
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
    .option('--agent <agentId>', 'Agent that owns the address (defaults to your configured agent)', requireNonEmptyArg('Agent ID'))
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

      // The verdict is decided inside the try and acted on OUTSIDE it. Calling
      // process.exit() in the try means anything that unwinds the stack —
      // notably the test harness, which throws an ExitSignal in place of
      // exiting — lands in the catch below and is re-reported as a failure to
      // validate. That produced `{"status":"error","message":""}` on a call
      // that had in fact validated fine and simply come back invalid.
      let valid = false;

      try {
        const agentId = await resolveAgentId(opts.agent, output);

        const orpc = await requireOrpcAuth(globals);
        const response = await orpc.address.validate({
          id: addressId,
          agentId,
        });
        valid = response.valid;

        if (output.isMachineFormat()) {
          output.json(response);
        } else if (response.valid) {
          output.success('Address is valid');
        } else {
          output.error('Address validation failed');
          // `details`, not `info`: these are the API's suggested corrections —
          // data, and the most useful part of a failed verdict. `info` renders
          // for humans only, which was survivable here ONLY because the branch
          // above now hands machine callers the whole `response`, suggestions
          // included. Rendering data through a decoration channel is how that
          // became invisible in the first place.
          if (response.suggestions.length > 0) {
            output.details(
              response.suggestions.map(
                (suggestion, index): [string, string] => [
                  `Suggestion ${index + 1}`,
                  formatSuggestion(suggestion),
                ],
              ),
            );
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

      // The verdict is this command's whole contract, so it decides the exit —
      // after rendering, and regardless of format. Reporting "validation
      // failed" and exiting 0 let `validate … && ship` ship an address the API
      // rejected, while the same script correctly halted when the API was
      // merely down. Matches `doctor`, which exits on the verdict, not the
      // format.
      if (!valid) process.exit(1);
    });
}
