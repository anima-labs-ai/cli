import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface CallDetails {
  id: string;
  agentId: string;
  direction: string;
  state: string;
  from: string;
  to: string;
  tier: string;
  voiceId?: string;
  durationSeconds?: number | null;
  startedAt: string;
  endedAt?: string | null;
  recordingUrl?: string;
  metadata?: Record<string, unknown>;
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export function getCallCommand(): Command {
  return new Command('get')
    .description('Get details of a specific voice call')
    .argument('<callId>', 'Call ID')
    .action(async function (this: Command, callId: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const call = await client.get<CallDetails>(`/voice/calls/${callId}`);

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
          ['Voice ID', call.voiceId ?? '-'],
          ['Duration', formatDuration(call.durationSeconds)],
          ['Started', new Date(call.startedAt).toLocaleString()],
          ['Ended', call.endedAt ? new Date(call.endedAt).toLocaleString() : '-'],
          ['Recording', call.recordingUrl ?? 'None'],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to get call: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
