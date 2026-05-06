import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface RegisterOptions {
  agentId: string;
  name: string;
  description?: string;
  tags?: string;
  public?: boolean;
}

export function registerAgentCommand(): Command {
  return new Command('register')
    .description('Register an agent in the public registry')
    .requiredOption('--agent-id <id>', 'Agent ID (CUID)')
    .requiredOption('--name <name>', 'Display name (2-200 chars)')
    .option('--description <desc>', 'Agent description (max 2000 chars)')
    .option('--tags <tags>', 'Comma-separated tags (max 20)')
    .option('--public', 'List the agent publicly')
    .action(async function (this: Command) {
      const opts = this.opts<RegisterOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const entry = await orpc.registry.register({
          agentId: opts.agentId,
          name: opts.name,
          description: opts.description,
          tags: opts.tags ? opts.tags.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          public: opts.public,
        });

        if (globals.json) {
          output.json(entry);
          return;
        }

        output.details([
          ['DID', entry.did],
          ['Name', entry.name],
          ['Description', entry.description ?? '-'],
          ['Agent ID', entry.agentId],
          ['Organization ID', entry.orgId],
          ['Public', entry.public ? 'Yes' : 'No'],
          ['Capabilities', entry.capabilities.join(', ') || '-'],
          ['Tags', entry.tags.join(', ') || '-'],
          ['Trust Score', String(entry.trustScore)],
          ['KYA Level', entry.kyaLevel],
          ['Verified', entry.verified ? 'Yes' : 'No'],
          ['Listed At', entry.listedAt],
        ]);
        output.success(`Agent registered: ${entry.did}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to register agent');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to this agent.');
    } else if (error.status === 404) {
      output.error('Agent not found.');
    } else if (error.status === 409) {
      output.error(`${context}: ${error.message}`);
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
