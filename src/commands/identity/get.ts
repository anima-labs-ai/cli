import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface GetIdentityOptions {
  id: string;
}

export function getIdentityCommand(): Command {
  return new Command('get')
    .description('Get an identity by ID')
    .requiredOption('--id <id>', 'Identity ID')
    .action(async function (this: Command) {
      const opts = this.opts<GetIdentityOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const agent = await orpc.agent.get({ id: opts.id });

        if (globals.json) {
          output.json(agent);
          return;
        }

        const primaryEmail = agent.emailIdentities.find((e) => e.isPrimary)?.email;
        const primaryPhone = agent.phoneIdentities.find((p) => p.isPrimary)?.phoneNumber;

        output.details([
          ['ID', agent.id],
          ['Organization ID', agent.orgId],
          ['Name', agent.name],
          ['Slug', agent.slug],
          ['Status', agent.status],
          ['API Key Prefix', agent.apiKeyPrefix ?? '-'],
          ['Key Rotated At', agent.keyRotatedAt ?? 'Never'],
          ['Primary Email', primaryEmail ?? '-'],
          ['Primary Phone', primaryPhone ?? '-'],
          ['Created At', agent.createdAt],
          ['Updated At', agent.updatedAt],
          ['Metadata', Object.keys(agent.metadata).length > 0 ? JSON.stringify(agent.metadata) : '-'],
        ]);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to get identity');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Identity not found.');
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
