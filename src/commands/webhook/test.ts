import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface TestWebhookResponse {
  success: boolean;
  statusCode?: number;
  responseTime?: number;
  error?: string;
}

export function testWebhookCommand(): Command {
  return new Command('test')
    .description('Send a test event to a webhook')
    .argument('<id>', 'Webhook ID')
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.post<TestWebhookResponse>(`/api/v1/webhooks/${id}/test`);

        if (globals.json) {
          output.json(result);
          return;
        }

        if (result.success) {
          output.success(`Webhook ${id} test succeeded`);
        } else {
          output.error(`Webhook ${id} test failed: ${result.error ?? 'unknown error'}`);
        }

        output.details([
          ['Status Code', result.statusCode !== undefined ? String(result.statusCode) : undefined],
          ['Response Time', result.responseTime !== undefined ? `${result.responseTime}ms` : undefined],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to test webhook: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to test webhook: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
