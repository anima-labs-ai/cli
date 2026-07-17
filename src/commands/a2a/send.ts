import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface SendOptions {
  agent: string;
  type: string;
  input: string;
  fromDid?: string;
}

export function sendTaskCommand(): Command {
  return new Command('send')
    .description('Submit a task to an agent via A2A protocol')
    .requiredOption('--agent <id>', 'Target agent ID', requireNonEmptyArg('Target agent ID'))
    .requiredOption('--type <type>', 'Task type identifier')
    .requiredOption('--input <json>', 'Task input as JSON string')
    .option('--from-did <did>', 'DID of the requesting agent')
    .action(async function (this: Command) {
      const opts = this.opts<SendOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        let parsedInput: Record<string, unknown>;
        try {
          parsedInput = JSON.parse(opts.input) as Record<string, unknown>;
        } catch {
          output.error('Invalid JSON for --input');
          process.exit(1);
        }

        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.a2a.submitTask({
          agentId: opts.agent,
          type: opts.type,
          input: parsedInput,
          from: opts.fromDid ?? '',
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Task submitted: ${result.id} (status: ${result.status})`);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to submit task: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to submit task: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
