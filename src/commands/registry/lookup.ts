import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface LookupOptions {
  did: string;
}

export function lookupAgentCommand(): Command {
  return new Command('lookup')
    .description('Look up an agent in the registry by DID')
    .requiredOption('--did <did>', 'Agent DID')
    .action(async function (this: Command) {
      const opts = this.opts<LookupOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const entry = await orpc.registry.lookup({ did: opts.did });

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
          ['Verified At', entry.verifiedAt ?? 'Never'],
          ['Listed At', entry.listedAt],
          ['Updated At', entry.updatedAt],
        ]);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to look up agent');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Agent not found in registry.');
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
