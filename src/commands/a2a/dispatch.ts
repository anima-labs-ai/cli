import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface DispatchOptions {
  from: string;
  toDid: string;
  type: string;
  input: string;
}

export function dispatchCommand(): Command {
  return new Command('dispatch')
    .description('Dispatch a task from one of your agents to another agent by DID')
    .requiredOption('--from <id>', 'Sending agent ID (must belong to your org)', requireNonEmptyArg('Sending agent ID'))
    .requiredOption('--to-did <did>', 'Recipient agent DID', requireNonEmptyArg('Recipient agent DID'))
    .requiredOption('--type <type>', 'Task type identifier')
    .requiredOption('--input <json>', 'Task input as JSON string')
    .action(async function (this: Command) {
      const opts = this.opts<DispatchOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      // Annotated, not inferred, so a later output.fatal()'s `never` narrows control flow.
      const output: Output = Output.fromGlobals(globals);

      try {
        let parsedInput: Record<string, unknown>;
        try {
          parsedInput = JSON.parse(opts.input) as Record<string, unknown>;
        } catch {
          output.fatal('Invalid JSON for --input');
        }

        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.a2a.dispatch({
          fromAgentId: opts.from,
          toDid: opts.toDid,
          type: opts.type,
          input: parsedInput,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Task dispatched: ${result.id} (status: ${result.status})`);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to dispatch task: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to dispatch task: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
