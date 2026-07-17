import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { collectValue, requireNonEmptyArg } from '../../lib/args.js';

interface LabelOptions {
  add: string[];
  remove: string[];
}

/**
 * `anima message label <id>` — add and/or remove workflow labels on one
 * message (spec B3), backed by PATCH /messages/{id}/labels.
 *
 * Add/remove, never a whole-array set. Two agents working the same inbox would
 * race on a set — each reads the array, writes its own version back, and the
 * slower write erases the other's tag. Add and remove are commutative, so the
 * endpoint (and this command) expose only that shape; a `--set` here would
 * quietly reintroduce the very race the API's design removes.
 *
 * System labels: `unread`/`read` (one state under two names — adding `read`
 * clears `unread` and vice versa, and a message always carries exactly one),
 * `archived`, and `spam`. Any other value is a tag the caller invents.
 *
 * Supplying neither `--add` nor `--remove` is refused here rather than sent as
 * an empty PATCH: an update that changes nothing is a usage mistake, and the
 * server would 400 it anyway — failing before the request keeps the reason
 * legible instead of surfacing a generic API error.
 */
export function labelMessageCommand(): Command {
  return new Command('label')
    .description('Add and/or remove labels on a message (e.g. mark read/unread, archive)')
    .argument('<id>', 'Message ID', requireNonEmptyArg('Message ID'))
    .option('--add <label>', 'Label to add (repeatable). Adding `read` clears `unread` and vice versa', collectValue, [])
    .option('--remove <label>', 'Label to remove (repeatable)', collectValue, [])
    .action(async function (this: Command, id: string) {
      const opts = this.opts<LabelOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      const addLabels = opts.add.length > 0 ? opts.add : undefined;
      const removeLabels = opts.remove.length > 0 ? opts.remove : undefined;
      if (!addLabels && !removeLabels) {
        output.error('Supply at least one of --add or --remove.');
        process.exit(1);
        return;
      }

      try {
        const orpc = await requireOrpcAuth(globals);
        const message = await orpc.message.updateLabels({ id, addLabels, removeLabels });

        if (globals.json) {
          output.json(message);
          return;
        }

        output.success(`Labels on ${message.id}: ${message.labels.join(', ') || '(none)'}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to update labels');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Message not found.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to this resource.');
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
