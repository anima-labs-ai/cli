import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface GenerateOptions {
  agent: string;
  length?: number;
  uppercase?: boolean;
  lowercase?: boolean;
  numbers?: boolean;
  special?: boolean;
}

interface GeneratePasswordInput {
  agentId: string;
  length?: number;
  uppercase?: boolean;
  lowercase?: boolean;
  number?: boolean;
  special?: boolean;
}

interface GeneratePasswordResponse {
  password: string;
}

export function generateCommand(): Command {
  return new Command('generate')
    .description('Generate password')
    .requiredOption('--agent <id>', 'Agent ID')
    .option('--length <number>', 'Password length (4-128)', Number.parseInt)
    .option('--uppercase', 'Include uppercase letters')
    .option('--lowercase', 'Include lowercase letters')
    .option('--numbers', 'Include numbers')
    .option('--special', 'Include special characters')
    .action(async function (this: Command) {
      const opts = this.opts<GenerateOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const body: GeneratePasswordInput = {
          agentId: opts.agent,
        };

        if (opts.length !== undefined) {
          body.length = opts.length;
        }
        if (opts.uppercase !== undefined) {
          body.uppercase = opts.uppercase;
        }
        if (opts.lowercase !== undefined) {
          body.lowercase = opts.lowercase;
        }
        if (opts.numbers !== undefined) {
          body.number = opts.numbers;
        }
        if (opts.special !== undefined) {
          body.special = opts.special;
        }

        const client = await requireAuth(globals);
        const result = await client.post<GeneratePasswordResponse>('/api/v1/vault/generate-password', body);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success('Generated password');
        output.details([['Password', result.password]]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to generate password: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to generate password: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
