import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface SendEmailOptions {
  agent: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  html?: string;
}

interface SendEmailBody {
  agentId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
}

interface SendEmailResponse {
  id: string;
  [key: string]: unknown;
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

export function sendEmailCommand(): Command {
  return new Command('send')
    .description('Send an email')
    .requiredOption('--agent <id>', 'Agent ID')
    .requiredOption('--to <email>', 'Recipient email', collect, [])
    .requiredOption('--subject <subject>', 'Email subject')
    .requiredOption('--body <body>', 'Email body text')
    .option('--cc <email>', 'CC recipient email', collect, [])
    .option('--bcc <email>', 'BCC recipient email', collect, [])
    .option('--html <html>', 'HTML email body')
    .action(async function (this: Command) {
      const opts = this.opts<SendEmailOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        if (opts.subject.length < 1 || opts.subject.length > 998) {
          output.error('Subject must be between 1 and 998 characters.');
          process.exit(1);
        }

        const client = await requireAuth(globals);
        const payload: SendEmailBody = {
          agentId: opts.agent,
          to: opts.to,
          subject: opts.subject,
          body: opts.body,
        };

        if (opts.cc.length > 0) {
          payload.cc = opts.cc;
        }
        if (opts.bcc.length > 0) {
          payload.bcc = opts.bcc;
        }
        if (opts.html) {
          payload.bodyHtml = opts.html;
        }

        const result = await client.post<SendEmailResponse>('/api/v1/email/send', payload);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Email sent (${result.id})`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to send email: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to send email: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
