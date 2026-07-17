import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface CreateIdentityOptions {
  org: string;
  name: string;
  slug: string;
  email?: string;
  provisionPhone?: boolean;
  metadata?: string;
}

export function createIdentityCommand(): Command {
  return new Command('create')
    .description('Create an identity')
    .requiredOption('--org <orgId>', 'Organization ID', requireNonEmptyArg('Organization ID'))
    .requiredOption('--name <name>', 'Identity name (2-100 chars)')
    .requiredOption('--slug <slug>', 'Identity slug (2-64 chars)')
    .option('--email <email>', 'Identity email')
    .option('--provision-phone', 'Provision a phone number')
    .option('--metadata <json>', 'JSON metadata object')
    .action(async function (this: Command) {
      const opts = this.opts<CreateIdentityOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const agent = await orpc.agent.create({
          orgId: opts.org,
          name: opts.name,
          slug: opts.slug,
          email: opts.email,
          provisionPhone: opts.provisionPhone,
          metadata: opts.metadata ? parseMetadata(opts.metadata) : {},
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
          ['Created At', agent.createdAt],
          ['Metadata', Object.keys(agent.metadata).length > 0 ? JSON.stringify(agent.metadata) : '-'],
        ]);
        output.success(`Identity created: ${agent.id}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to create identity');
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

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to this organization.');
    } else if (error.status === 404) {
      output.error('Organization not found.');
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
