import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface ListOptions {
  agent?: string;
}

export function listCommand(): Command {
  return new Command('list')
    .description('List credentials')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .action(async function (this: Command) {
      const opts = this.opts<ListOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.list({ agentId: opts.agent });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Type', 'Name', 'Username', 'Favorite', 'Updated'],
          result.items.map((item) => [
            item.id,
            item.type,
            item.name,
            item.login?.username ?? '',
            item.favorite ? 'Yes' : 'No',
            item.updatedAt,
          ]),
        );
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else {
            output.error(`Failed to list credentials: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to list credentials: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
