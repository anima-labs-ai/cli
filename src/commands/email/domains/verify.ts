import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../../lib/orpc.js';
import { requireNonEmptyArg } from '../../../lib/args.js';

export function verifyDomainCommand(): Command {
  return new Command('verify')
    .description('Verify a sending domain')
    .argument('<id>', 'Domain ID', requireNonEmptyArg('Domain ID'))
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.domain.verify({
          id,
          domainId: id,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['ID', result.id],
          ['Domain', result.domain],
          ['Status', result.status],
          ['Verified', result.verified ? 'Yes' : 'No'],
        ]);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to verify domain');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Domain not found.');
    } else {
      output.error(`${context}: ${error.message}`);
    }
  } else if (error instanceof Error) {
    output.error(`${context}: ${error.message}`);
  } else {
    output.error(context);
  }
  process.exit(1);
}
