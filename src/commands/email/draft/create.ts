import { Command } from 'commander';
import { requireNonEmptyArg } from '../../../lib/args.js';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../../lib/orpc.js';
import { formatDraftDetails } from './format.js';

interface CreateDraftOptions {
  agent: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject?: string;
  body?: string;
  html?: string;
  fromIdentity?: string;
  inReplyTo?: string;
  reference: string[];
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

export function createDraftCommand(): Command {
  return new Command('create')
    .description('Create an email draft (drafts may be incomplete — only --agent is required)')
    .requiredOption('--agent <id>', 'Owning agent ID', requireNonEmptyArg('Owning agent ID'))
    .option('--to <email>', 'Recipient email (repeatable)', collect, [])
    .option('--cc <email>', 'CC recipient email (repeatable)', collect, [])
    .option('--bcc <email>', 'BCC recipient email (repeatable)', collect, [])
    .option('--subject <subject>', 'Subject line')
    .option('--body <body>', 'Plain-text body')
    .option('--html <html>', 'HTML body')
    .option('--from-identity <id>', 'EmailIdentity ID to send from (must belong to the agent and be verified)')
    .option('--in-reply-to <messageId>', 'In-Reply-To Message-ID for threading on send')
    .option('--reference <messageId>', 'References chain Message-ID for threading (repeatable)', collect, [])
    .action(async function (this: Command) {
      const opts = this.opts<CreateDraftOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const draft = await orpc.emailDraft.create({
          agentId: opts.agent,
          fromIdentityId: opts.fromIdentity,
          to: opts.to,
          cc: opts.cc.length > 0 ? opts.cc : undefined,
          bcc: opts.bcc.length > 0 ? opts.bcc : undefined,
          subject: opts.subject,
          body: opts.body,
          bodyHtml: opts.html,
          inReplyTo: opts.inReplyTo,
          references: opts.reference.length > 0 ? opts.reference : undefined,
        });

        if (globals.json) {
          output.json(draft);
          return;
        }

        output.details(formatDraftDetails(draft));
        output.success(`Draft created (${draft.id}). Send it with: anima email draft send ${draft.id}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to create draft');
      }
    });
}
