import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
import pc from 'picocolors';

interface CallScoreResponse {
  callId: string;
  overallScore: number;
  subscores: {
    resolution: number;
    sentiment: number;
    efficiency: number;
    engagement: number;
    latency: number;
    compliance: number;
  };
  metrics: {
    durationSeconds: number;
    agentSpeakingSeconds: number;
    callerSpeakingSeconds: number;
    talkToListenRatio: number;
    longestMonologueSeconds: number;
    deadAirCount: number;
    deadAirSeconds: number;
    averageResponseLatencySeconds: number;
  };
  scoredAt: string;
}

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
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const score = await client.get<CallScoreResponse>(
          `/voice/calls/${callId}/score`,
        );

        if (globals.json) {
          output.json(score);
          return;
        }

        const overallColor = scoreColor(score.overallScore);
        console.log(pc.bold(pc.cyan('Call Score')));
        console.log();
        console.log(`  ${pc.bold('Overall:')}  ${scoreBar(score.overallScore)}  ${overallColor(String(score.overallScore))}/100`);
        console.log();

        console.log(pc.bold('  Subscores:'));
        printSubscore('Resolution', score.subscores.resolution);
        printSubscore('Sentiment', score.subscores.sentiment);
        printSubscore('Efficiency', score.subscores.efficiency);
        printSubscore('Engagement', score.subscores.engagement);
        printSubscore('Latency', score.subscores.latency);
        printSubscore('Compliance', score.subscores.compliance);

        console.log();
        console.log(pc.bold('  Metrics:'));
        printMetric('Duration', `${score.metrics.durationSeconds}s`);
        printMetric('Agent speaking', `${score.metrics.agentSpeakingSeconds}s`);
        printMetric('Caller speaking', `${score.metrics.callerSpeakingSeconds}s`);
        printMetric('Talk/listen ratio', score.metrics.talkToListenRatio.toFixed(2));
        printMetric('Longest monologue', `${score.metrics.longestMonologueSeconds}s`);
        printMetric('Dead air', `${score.metrics.deadAirCount}x (${score.metrics.deadAirSeconds}s)`);
        printMetric('Avg response latency', `${score.metrics.averageResponseLatencySeconds.toFixed(1)}s`);

        console.log();
        output.info(`Scored at ${new Date(score.scoredAt).toLocaleString()}`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
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
