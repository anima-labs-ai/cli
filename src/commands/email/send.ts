import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../lib/orpc.js';

interface SendEmailOptions {
  agent: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  html?: string;
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

export function sendEmailCommand(): Command {
  return new Command('send')
    .description('Send an email')
    .requiredOption('--agent <id>', 'Agent ID', requireNonEmptyArg('Agent ID'))
    .requiredOption('--to <email>', 'Recipient email', collect, [])
    .requiredOption('--subject <subject>', 'Email subject')
    .requiredOption('--body <body>', 'Email body text')
    .option('--cc <email>', 'CC recipient email', collect, [])
    .option('--bcc <email>', 'BCC recipient email', collect, [])
    .option('--html <html>', 'HTML email body')
    .action(async function (this: Command) {
      const opts = this.opts<SendEmailOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        if (opts.subject.length < 1 || opts.subject.length > 998) {
          output.fatal('Subject must be between 1 and 998 characters.');
        }

        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.email.send({
          agentId: opts.agent,
          to: opts.to,
          cc: opts.cc.length > 0 ? opts.cc : undefined,
          bcc: opts.bcc.length > 0 ? opts.bcc : undefined,
          subject: opts.subject,
          body: opts.body,
          bodyHtml: opts.html,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Email sent (${result.id})`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to send email');
      }
    });
}
