import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface GenerateOptions {
  agent?: string;
  length?: number;
  uppercase?: boolean;
  lowercase?: boolean;
  numbers?: boolean;
  special?: boolean;
}

export function generateCommand(): Command {
  return new Command('generate')
    .description('Generate password')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .option('--length <number>', 'Password length (4-128)', Number.parseInt)
    .option('--uppercase', 'Include uppercase letters')
    .option('--lowercase', 'Include lowercase letters')
    .option('--numbers', 'Include numbers')
    .option('--special', 'Include special characters')
    .action(async function (this: Command) {
      const opts = this.opts<GenerateOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        // The contract field is `number` (singular) — the CLI flag stays
        // `--numbers` (plural) for ergonomics, but we map to the contract name.
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.generatePassword({
          agentId: opts.agent,
          length: opts.length,
          uppercase: opts.uppercase,
          lowercase: opts.lowercase,
          number: opts.numbers,
          special: opts.special,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success('Generated password');
        output.details([['Password', result.password]]);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else {
            output.error(`Failed to generate password: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to generate password: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
