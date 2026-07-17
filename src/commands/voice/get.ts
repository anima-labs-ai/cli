import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { requireNonEmptyArg } from '../../lib/args.js';

function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export function getCallCommand(): Command {
  return new Command('get')
    .description('Get details of a specific voice call')
    .argument('<callId>', 'Call ID', requireNonEmptyArg('Call ID'))
    .action(async function (this: Command, callId: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const call = await orpc.voice.getCall({ callId });

        if (globals.json) {
          output.json(call);
          return;
        }

        output.details([
          ['ID', call.id],
          ['Agent ID', call.agentId],
          ['Direction', call.direction],
          ['State', call.state],
          ['From', call.from],
          ['To', call.to],
          ['Tier', call.tier],
          ['Duration', formatDuration(call.durationSeconds)],
          ['Started', new Date(call.startedAt).toLocaleString()],
          ['Ended', call.endedAt ? new Date(call.endedAt).toLocaleString() : '-'],
          ['End reason', call.endReason ?? '-'],
        ]);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to get call: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
