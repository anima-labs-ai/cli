import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface SendOptions {
  agent: string;
  type: string;
  input: string;
  fromDid?: string;
}

interface A2ATaskResponse {
  id: string;
  status: string;
  type: string;
  [key: string]: unknown;
}

export function sendTaskCommand(): Command {
  return new Command('send')
    .description('Submit a task to an agent via A2A protocol')
    .requiredOption('--agent <id>', 'Target agent ID')
    .requiredOption('--type <type>', 'Task type identifier')
    .requiredOption('--input <json>', 'Task input as JSON string')
    .option('--from-did <did>', 'DID of the requesting agent')
    .action(async function (this: Command) {
      const opts = this.opts<SendOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        let parsedInput: Record<string, unknown>;
        try {
          parsedInput = JSON.parse(opts.input) as Record<string, unknown>;
        } catch {
          output.error('Invalid JSON for --input');
          process.exit(1);
        }

        const client = await requireAuth(globals);
        const body: Record<string, unknown> = {
          type: opts.type,
          input: parsedInput,
        };
        if (opts.fromDid) {
          body.fromDid = opts.fromDid;
        }

        const result = await client.post<A2ATaskResponse>(
          `/agents/${opts.agent}/a2a/tasks`,
          body,
        );

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Task submitted: ${result.id} (status: ${result.status})`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to submit task: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to submit task: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
