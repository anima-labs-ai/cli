import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type IdentityStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

interface UpdateIdentityOptions {
  id: string;
  name?: string;
  slug?: string;
  status?: IdentityStatus;
  metadata?: string;
}

interface UpdateIdentityRequest {
  id: string;
  name?: string;
  slug?: string;
  status?: IdentityStatus;
  metadata?: Record<string, unknown>;
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
  metadata?: unknown;
}

export function updateIdentityCommand(): Command {
  return new Command('update')
    .description('Update an identity')
    .requiredOption('--id <id>', 'Identity ID')
    .option('--name <name>', 'Identity name (2-100 chars)')
    .option('--slug <slug>', 'Identity slug (2-64 chars)')
    .option('--status <status>', 'Identity status (ACTIVE|SUSPENDED|DELETED)', validateStatus)
    .option('--metadata <json>', 'JSON metadata object')
    .action(async function (this: Command) {
      const opts = this.opts<UpdateIdentityOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      if (!opts.name && !opts.slug && !opts.status && !opts.metadata) {
        output.error('Provide at least one field to update: --name, --slug, --status, or --metadata');
        process.exit(1);
      }

      try {
        const client = await requireAuth(globals);
        const body: UpdateIdentityRequest = { id: opts.id };

        if (opts.name) {
          body.name = opts.name;
        }

        if (opts.slug) {
          body.slug = opts.slug;
        }

        if (opts.status) {
          body.status = opts.status;
        }

        if (opts.metadata) {
          body.metadata = parseMetadata(opts.metadata);
        }

        const result = await client.patch<Identity>(`/api/v1/agents/${opts.id}`, body);

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
          ['Metadata', result.metadata ? JSON.stringify(result.metadata) : undefined],
        ]);
        output.success(`Identity updated: ${result.id}`);
      } catch (error: unknown) {
        handleApiError(error, output, 'Failed to update identity');
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

function validateStatus(value: string): IdentityStatus {
  if (value === 'ACTIVE' || value === 'SUSPENDED' || value === 'DELETED') {
    return value;
  }
  throw new InvalidArgumentError('status must be one of ACTIVE, SUSPENDED, DELETED');
}

function handleApiError(error: unknown, output: Output, context: string): never {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `am auth login` to authenticate.');
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
