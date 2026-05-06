import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface ScanOptions {
  org?: string;
}

export function securityScanCommand(): Command {
  return new Command('scan')
    .description('Show scanner health status')
    .option('--org <orgId>', 'Organization ID (derived from auth if omitted)')
    .action(async function (this: Command) {
      const opts = this.opts<ScanOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.security.scannerStatus({ orgId: opts.org });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['AI Scanner Active', result.aiScanner.active ? 'yes' : 'no'],
          ['Provider', result.aiScanner.provider ?? '-'],
          ['Fallback Reason', result.aiScanner.fallbackReason ?? '-'],
        ]);

        if (result.aiScanner.active) {
          output.success('Scanner is operational');
        } else {
          output.warn('Scanner is not active');
        }
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to fetch scanner status');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to this organization.');
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
