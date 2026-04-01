import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface RotateIdentityKeyOptions {
  id: string;
}

interface RotateKeyResponse {
  id: string;
  apiKey: string;
  rotatedAt?: string;
}

export function rotateIdentityKeyCommand(): Command {
  return new Command('rotate-key')
    .description('Rotate API key for an identity')
    .requiredOption('--id <id>', 'Identity ID')
    .action(async function (this: Command) {
      const opts = this.opts<RotateIdentityKeyOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.post<RotateKeyResponse>(`/agents/${opts.id}/rotate-key`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['ID', result.id],
          ['API Key', result.apiKey],
          ['Rotated At', result.rotatedAt],
        ]);
        output.success(`API key rotated for identity: ${result.id}`);
      } catch (error: unknown) {
        handleApiError(error, output, 'Failed to rotate identity API key');
      }
    });
}

function handleApiError(error: unknown, output: Output, context: string): never {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Identity not found.');
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
