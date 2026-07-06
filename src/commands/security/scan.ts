import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { getConfig } from '../../lib/config.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface ScanOptions {
  org?: string;
}

export function securityScanCommand(): Command {
  return new Command('scan')
    .description('Show scanner health status')
    .option('--org <orgId>', 'Organization ID (defaults to configured default org)')
    .action(async function (this: Command) {
      const opts = this.opts<ScanOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        // orgId is a path parameter on the contract, so it must be resolved
        // client-side: explicit --org flag, then the configured default org.
        const orgId = opts.org ?? (await getConfig()).defaultOrg;
        if (!orgId) {
          throw new Error(
            "No org specified. Use --org <org> or set default with 'anima config set defaultOrg <org>'",
          );
        }
        const result = await orpc.security.scannerStatus({ orgId });

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
