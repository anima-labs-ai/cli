import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface SendSmsOptions {
  agent: string;
  to: string;
  body: string;
  mediaUrl?: string[];
}

interface SendSmsResponse {
  id?: string;
  status?: string;
  to?: string;
  body?: string;
}

function validateTo(to: string): string {
  const value = to.trim();
  if (value.length < 7 || value.length > 20) {
    throw new Error('Invalid --to. Must be between 7 and 20 characters');
  }
  return value;
}

function validateBody(body: string): string {
  if (body.length < 1 || body.length > 1600) {
    throw new Error('Invalid --body. Must be between 1 and 1600 characters');
  }
  return body;
}

export function sendSmsCommand(): Command {
  return new Command('send-sms')
    .description('Send an SMS from an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .requiredOption('--to <number>', 'Destination phone number')
    .requiredOption('--body <message>', 'SMS message body')
    .option('--media-url <url>', 'Media URL (repeatable)', (value: string, previous: string[] = []) => {
      previous.push(value);
      return previous;
    })
    .action(async function (this: Command) {
      const opts = this.opts<SendSmsOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const to = validateTo(opts.to);
        const body = validateBody(opts.body);

        const payload: {
          agentId: string;
          to: string;
          body: string;
          mediaUrls?: string[];
        } = {
          agentId: opts.agent,
          to,
          body,
        };

        if (opts.mediaUrl && opts.mediaUrl.length > 0) {
          payload.mediaUrls = opts.mediaUrl;
        }

        const client = await requireAuth(globals);
        const response = await client.post<SendSmsResponse>('/api/v1/phone/send-sms', payload);

        if (globals.json) {
          output.json(response);
          return;
        }

        output.details([
          ['Message ID', response.id],
          ['Status', response.status],
          ['To', response.to ?? to],
        ]);
        output.success('SMS sent');
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to send SMS: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
