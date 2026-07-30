import { Command } from 'commander';
import { resolveOrgId } from '../../lib/agent.js';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../lib/orpc.js';

interface CreateIdentityOptions {
  org?: string;
  name: string;
  slug: string;
  email?: string;
  provisionPhone?: boolean;
  metadata?: string;
}

export function createIdentityCommand(): Command {
  return new Command('create')
    .description('Create an agent')
    // Optional, not required: a mandatory option is enforced during parse, so
    // `am identity create` rejected the command before its action body could
    // read the defaultOrg `am init` had already written.
    .option('--org <orgId>', 'Organization ID (defaults to your current org)', requireNonEmptyArg('Organization ID'))
    .requiredOption('--name <name>', 'Identity name (2-100 chars)')
    .requiredOption('--slug <slug>', 'Identity slug (2-64 chars)')
    .option('--email <email>', 'Identity email')
    .option('--provision-phone', 'Provision a phone number')
    .option('--metadata <json>', 'JSON metadata object')
    .action(async function (this: Command) {
      const opts = this.opts<CreateIdentityOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      // Resolved before the try: a `fatal` raised inside it would be caught by
      // the handler that renders API failures, which rewrites the exit code and
      // reports missing input as a request that failed.
      const orgId = await resolveOrgId(opts.org, output);

      try {
        const orpc = await requireOrpcAuth(globals);
        const agent = await orpc.agent.create({
          orgId,
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
        handleOrpcError(error, output, 'Failed to create identity', { statusMessages: { 403: 'Forbidden: you do not have access to this organization.', 404: 'Organization not found.' } });
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
