import { Command } from 'commander';
import { getAuthConfig } from '../../lib/config.js';
import { getApiClient } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';

interface WhoamiResponse {
  email: string;
  orgId: string;
  orgName: string;
  role: string;
}

export function whoamiCommand(): Command {
  return new Command('whoami')
    .description('Display current authentication status')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const auth = await getAuthConfig();

      if (!auth.token && !auth.apiKey) {
        output.error('Not authenticated. Run `am auth login` first.');
        process.exit(1);
      }

      try {
        const client = await getApiClient(globals);
        const result = await client.get<WhoamiResponse>('/api/v1/auth/me');

        output.details([
          ['Email', result.email],
          ['Organization', result.orgName],
          ['Org ID', result.orgId],
          ['Role', result.role],
          ['Auth Method', auth.apiKey ? 'API Key' : 'Token'],
          ['API URL', auth.apiUrl ?? 'http://localhost:4001'],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          if (error.status === 401) {
            output.error('Session expired. Run `am auth login` again.');
          } else {
            output.error(`Failed to fetch account info: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to fetch account info: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
