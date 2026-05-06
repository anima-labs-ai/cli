import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import pc from 'picocolors';

export function summaryCommand(): Command {
  return new Command('summary')
    .description('Print the AI-generated summary of a voice call')
    .argument('<callId>', 'Call ID')
    .option('--narrative', 'Include narrative summary')
    .action(async function (this: Command, callId: string) {
      const opts = this.opts<{ narrative?: boolean }>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const summary = await orpc.voice.getSummary({ callId });

        if (globals.json) {
          output.json(summary);
          return;
        }

        console.log(pc.bold(pc.cyan('Call Summary')));
        console.log();
        console.log(`${pc.bold('One-liner:')} ${summary.oneLiner}`);
        console.log(`${pc.bold('Intent:')} ${summary.intent}`);
        console.log(`${pc.bold('Outcome:')} ${summary.outcome}`);

        printList('Topics', summary.topics);
        printList(
          'Action Items',
          summary.actionItems.map((a) => (a.owner ? `${a.text} (${a.owner})` : a.text)),
        );
        printList('Decisions', summary.decisions);
        printList('Open Questions', summary.openQuestions);
        printList('Next Steps', summary.nextSteps);

        if (opts.narrative && summary.narrative) {
          console.log();
          console.log(pc.bold('Narrative:'));
          console.log(summary.narrative);
        }

        console.log();
        output.info(`Generated at ${new Date(summary.generatedAt).toLocaleString()}`);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to get summary: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}

function printList(label: string, items: string[]): void {
  if (!items || items.length === 0) return;
  console.log();
  console.log(pc.bold(`${label}:`));
  for (const item of items) {
    console.log(`  • ${item}`);
  }
}
