import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface CreateIdentityOptions {
  org: string;
  name: string;
  slug: string;
  email?: string;
  provisionPhone?: boolean;
  metadata?: string;
}

interface Identity {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  email?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  apiKey?: string;
  metadata?: unknown;
}

interface CreateIdentityRequest {
  orgId: string;
  name: string;
  slug: string;
  email?: string;
  provisionPhone?: boolean;
  metadata?: Record<string, unknown>;
}

export function createIdentityCommand(): Command {
  return new Command('create')
    .description('Create an identity')
    .requiredOption('--org <orgId>', 'Organization ID')
    .requiredOption('--name <name>', 'Identity name (2-100 chars)')
    .requiredOption('--slug <slug>', 'Identity slug (2-64 chars)')
    .option('--email <email>', 'Identity email')
    .option('--provision-phone', 'Provision a phone number')
    .option('--metadata <json>', 'JSON metadata object')
    .action(async function (this: Command) {
      const opts = this.opts<CreateIdentityOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const body: CreateIdentityRequest = {
          orgId: opts.org,
          name: opts.name,
          slug: opts.slug,
        };

        if (opts.email) {
          body.email = opts.email;
        }

        if (opts.provisionPhone) {
          body.provisionPhone = true;
        }

        if (opts.metadata) {
          body.metadata = parseMetadata(opts.metadata);
        }

        const result = await client.post<Identity>('/agents', body);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['ID', result.id],
          ['Organization ID', result.orgId],
          ['Name', result.name],
          ['Slug', result.slug],
          ['Email', result.email],
          ['Status', result.status],
          ['Created At', result.createdAt],
          ['Updated At', result.updatedAt],
          ['API Key', result.apiKey],
          ['Metadata', result.metadata ? JSON.stringify(result.metadata) : undefined],
        ]);
        output.success(`Identity created: ${result.id}`);
      } catch (error: unknown) {
        handleApiError(error, output, 'Failed to create identity');
      }
    });
}

function parseMetadata(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'INVALID_METADATA', 'Metadata must be valid JSON object');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(400, 'INVALID_METADATA', 'Metadata must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

function handleApiError(error: unknown, output: Output, context: string): never {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to this organization.');
    } else if (error.status === 404) {
      output.error('Organization not found.');
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
