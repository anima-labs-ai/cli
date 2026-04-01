import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

export function deleteCardCommand(): Command {
  return new Command('delete')
    .description('Delete or cancel a card')
    .argument('<cardId>', 'Card ID')
    .action(async function (this: Command, cardId: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.delete<Record<string, unknown>>(`/cards/${cardId}`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Card ${cardId} deleted`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to delete card: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to delete card: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
