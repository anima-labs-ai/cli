import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface ScanResult {
  safe: boolean;
  threats: Threat[];
  scannedAt?: string;
}

interface Threat {
  type: string;
  severity: string;
  description: string;
}

export function securityScanCommand(): Command {
  return new Command('scan')
    .description('Scan content for security threats')
    .argument('<content>', 'Content to scan (URL, email address, or text)')
    .action(async function (this: Command, content: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.post<ScanResult>('/security/scan', { content });

        if (globals.json) {
          output.json(result);
          return;
        }

        if (result.safe) {
          output.success('Content scan passed — no threats detected');
        } else {
          output.warn(`Content scan found ${result.threats.length} threat(s)`);
        }

        if (result.threats.length > 0) {
          output.table(
            ['Type', 'Severity', 'Description'],
            result.threats.map((t) => [t.type, t.severity, t.description]),
          );
        }

        if (result.scannedAt) {
          output.info(`Scanned at: ${result.scannedAt}`);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to scan content: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to scan content: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
