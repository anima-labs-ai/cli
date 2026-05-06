import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

export function deleteCardCommand(): Command {
  return new Command('delete')
    .description('Delete or cancel a card')
    .argument('<cardId>', 'Card ID')
    .action(async function (this: Command, cardId: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.cards.delete({ cardId });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Card ${cardId} deleted`);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to delete card: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to delete card: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
