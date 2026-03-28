import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

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
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        await client.post(`/api/v1/agents/${opts.agent}/wallet/freeze`);

        if (globals.json) {
          output.json({ success: true });
          return;
        }

        output.success('Wallet frozen');
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to freeze wallet: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
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
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        await client.post(`/api/v1/agents/${opts.agent}/wallet/unfreeze`);

        if (globals.json) {
          output.json({ success: true });
          return;
        }

        output.success('Wallet unfrozen');
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to unfreeze wallet: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
