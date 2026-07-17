import { Command, InvalidArgumentError } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

type IdentityStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

interface UpdateIdentityOptions {
  id: string;
  name?: string;
  slug?: string;
  status?: IdentityStatus;
  metadata?: string;
}

export function updateIdentityCommand(): Command {
  return new Command('update')
    .description('Update an identity')
    .requiredOption('--id <id>', 'Identity ID', requireNonEmptyArg('Identity ID'))
    .option('--name <name>', 'Identity name (2-100 chars)')
    .option('--slug <slug>', 'Identity slug (2-64 chars)')
    .option('--status <status>', 'Identity status (ACTIVE|SUSPENDED|DELETED)', validateStatus)
    .option('--metadata <json>', 'JSON metadata object')
    .action(async function (this: Command) {
      const opts = this.opts<UpdateIdentityOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      if (!opts.name && !opts.slug && !opts.status && !opts.metadata) {
        output.error('Provide at least one field to update: --name, --slug, --status, or --metadata');
        process.exit(1);
      }

      try {
        const orpc = await requireOrpcAuth(globals);
        const agent = await orpc.agent.update({
          id: opts.id,
          name: opts.name,
          slug: opts.slug,
          status: opts.status,
          metadata: opts.metadata ? parseMetadata(opts.metadata) : undefined,
        });

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
          ['Primary Email', primaryEmail ?? '-'],
          ['Primary Phone', primaryPhone ?? '-'],
          ['Updated At', agent.updatedAt],
          ['Metadata', Object.keys(agent.metadata).length > 0 ? JSON.stringify(agent.metadata) : '-'],
        ]);
        output.success(`Identity updated: ${agent.id}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to update identity');
      }
    });
}

function parseMetadata(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Metadata must be valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Metadata must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

function validateStatus(value: string): IdentityStatus {
  if (value === 'ACTIVE' || value === 'SUSPENDED' || value === 'DELETED') {
    return value;
  }
  throw new InvalidArgumentError('status must be one of ACTIVE, SUSPENDED, DELETED');
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
