import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface RotateIdentityKeyOptions {
  id: string;
}

export function rotateIdentityKeyCommand(): Command {
  return new Command('rotate-key')
    .description('Rotate API key for an identity')
    .requiredOption('--id <id>', 'Identity ID')
    .action(async function (this: Command) {
      const opts = this.opts<RotateIdentityKeyOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.agent.rotateKey({ id: opts.id });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['ID', opts.id],
          ['API Key', result.apiKey],
          ['Key Prefix', result.apiKeyPrefix],
        ]);
        output.success(`API key rotated for identity: ${opts.id}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to rotate identity API key');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Identity not found.');
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
