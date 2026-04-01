import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface ReleaseOptions {
  agent: string;
  number: string;
}

export function releasePhoneNumberCommand(): Command {
  return new Command('release')
    .description('Release a provisioned phone number')
    .requiredOption('--agent <id>', 'Agent ID')
    .requiredOption('--number <phoneNumber>', 'Phone number to release')
    .action(async function (this: Command) {
      const opts = this.opts<ReleaseOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const response = await client.post<Record<string, unknown>>('/phone/release', {
          agentId: opts.agent,
          phoneNumber: opts.number,
        });

        if (globals.json) {
          output.json(response);
          return;
        }

        output.success(`Released phone number ${opts.number}`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to release phone number: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
