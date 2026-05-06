import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import pc from 'picocolors';

function scoreColor(score: number): (text: string) => string {
  if (score >= 80) return pc.green;
  if (score >= 60) return pc.yellow;
  return pc.red;
}

function scoreBar(score: number, width: number = 20): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const color = scoreColor(score);
  return color('█'.repeat(filled)) + pc.gray('░'.repeat(empty));
}

export function scoreCommand(): Command {
  return new Command('score')
    .description('Print the quality score of a voice call')
    .argument('<callId>', 'Call ID')
    .action(async function (this: Command, callId: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const score = await orpc.voice.getScore({ callId });

        if (globals.json) {
          output.json(score);
          return;
        }

        const overallColor = scoreColor(score.compositeScore);
        console.log(pc.bold(pc.cyan('Call Score')));
        console.log();
        console.log(`  ${pc.bold('Overall:')}  ${scoreBar(score.compositeScore)}  ${overallColor(String(score.compositeScore))}/100`);
        console.log();

        console.log(pc.bold('  Subscores:'));
        printSubscore('Resolution', score.resolutionScore);
        printSubscore('Sentiment', score.sentimentScore);
        printSubscore('Efficiency', score.efficiencyScore);
        printSubscore('Engagement', score.engagementScore);
        printSubscore('Latency', score.latencyScore);
        printSubscore('Compliance', score.complianceScore);

        if (Object.keys(score.metrics).length > 0) {
          console.log();
          console.log(pc.bold('  Metrics:'));
          for (const [label, value] of Object.entries(score.metrics)) {
            printMetric(label, formatMetric(value));
          }
        }

        console.log();
        output.info(`Scored at ${new Date(score.scoredAt).toLocaleString()}`);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to get score: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}

function printSubscore(label: string, value: number): void {
  const color = scoreColor(value);
  console.log(`    ${label.padEnd(14)} ${scoreBar(value, 15)}  ${color(String(value))}`);
}

function printMetric(label: string, value: string): void {
  console.log(`    ${pc.dim(label.padEnd(22))} ${value}`);
}

function formatMetric(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
