import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { resolveAgentId } from '../../lib/agent.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface DidOptions {
  agent?: string;
}

export function getDidCommand(): Command {
  return new Command('did')
    .description('Get the DID document for an agent')
    .option('--agent <id>', 'Agent ID (defaults to your configured identity)', requireNonEmptyArg('Agent ID'))
    .action(async function (this: Command) {
      const opts = this.opts<DidOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const agentId = await resolveAgentId(opts.agent, output);

        const orpc = await requireOrpcAuth(globals);
        const document = await orpc.identity.getAgentDid({ agentId });

        if (globals.json) {
          output.json(document);
          return;
        }

        output.details([
          ['DID', document.id],
          ['Controller', document.controller ?? '-'],
          ['Verification Methods', String(document.verificationMethod.length)],
          ['Authentication Methods', String(document.authentication.length)],
          ['Services', String(document.service?.length ?? 0)],
        ]);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 404) {
            output.error('DID not found for this agent.');
          } else {
            output.error(`Failed to get DID: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
