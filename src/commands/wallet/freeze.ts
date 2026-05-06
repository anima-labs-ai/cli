import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface FreezeOptions {
  agent: string;
}

export function walletFreezeCommand(): Command {
  return new Command('freeze')
    .description('Freeze an agent wallet')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<FreezeOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const wallet = await orpc.wallet.freeze({ agentId: opts.agent });

        if (globals.json) {
          output.json(wallet);
          return;
        }

        output.success(`Wallet frozen (status: ${wallet.status})`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to freeze wallet');
      }
    });
}

export function walletUnfreezeCommand(): Command {
  return new Command('unfreeze')
    .description('Unfreeze an agent wallet')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<FreezeOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const wallet = await orpc.wallet.unfreeze({ agentId: opts.agent });

        if (globals.json) {
          output.json(wallet);
          return;
        }

        output.success(`Wallet unfrozen (status: ${wallet.status})`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to unfreeze wallet');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to this wallet.');
    } else if (error.status === 404) {
      output.error('Wallet not found.');
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
