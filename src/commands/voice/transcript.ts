import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
import pc from 'picocolors';

interface TranscriptSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

interface TranscriptResponse {
  callId: string;
  segments: TranscriptSegment[];
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function transcriptCommand(): Command {
  return new Command('transcript')
    .description('Print the transcript of a voice call')
    .argument('<callId>', 'Call ID')
    .option('--speaker <speaker>', 'Filter by speaker (agent or caller)')
    .action(async function (this: Command, callId: string) {
      const opts = this.opts<{ speaker?: string }>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const response = await client.get<TranscriptResponse>(
          `/voice/calls/${callId}/transcript`,
        );

        if (globals.json) {
          output.json(response);
          return;
        }

        let segments = response.segments ?? [];

        if (opts.speaker) {
          segments = segments.filter((s) => s.speaker === opts.speaker);
        }

        if (segments.length === 0) {
          output.info('No transcript segments found');
          return;
        }

        for (const seg of segments) {
          const time = pc.gray(formatTimestamp(seg.startTime));
          const speaker =
            seg.speaker === 'agent' ? pc.cyan(pc.bold('Agent')) : pc.yellow(pc.bold('Caller'));
          console.log(`${time}  ${speaker}  ${seg.text}`);
        }

        output.info(`\n${segments.length} segment(s)`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to get transcript: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
