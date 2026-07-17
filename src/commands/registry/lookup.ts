import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../lib/orpc.js';

interface LookupOptions {
  did: string;
}

export function lookupAgentCommand(): Command {
  return new Command('lookup')
    .description('Look up an agent in the registry by DID')
    .requiredOption('--did <did>', 'Agent DID', requireNonEmptyArg('Agent DID'))
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
        handleOrpcError(error, output, 'Failed to look up agent', { statusMessages: { 404: 'Agent not found in registry.' } });
      }
    });
}
