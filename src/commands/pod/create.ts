import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface CreatePodOptions {
  name: string;
  slug: string;
  limits?: string;
  metadata?: string;
}

export function createPodCommand(): Command {
  return new Command('create')
    .description('Create a compute pod')
    .requiredOption('--name <name>', 'Pod name (2-100 chars)')
    .requiredOption('--slug <slug>', 'Pod slug (2-64 chars, lowercase alphanumeric and hyphens)')
    .option('--limits <json>', 'JSON resource limits object')
    .option('--metadata <json>', 'JSON metadata object')
    .action(async function (this: Command) {
      const opts = this.opts<CreatePodOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const pod = await orpc.pod.create({
          name: opts.name,
          slug: opts.slug,
          limits: opts.limits ? parseJsonObject(opts.limits, 'Limits') : undefined,
          metadata: opts.metadata ? parseJsonObject(opts.metadata, 'Metadata') : undefined,
        });

        if (globals.json) {
          output.json(pod);
          return;
        }

        output.details([
          ['ID', pod.id],
          ['Organization ID', pod.orgId],
          ['Name', pod.name],
          ['Slug', pod.slug],
          ['Status', pod.status],
          ['Limits', pod.limits ? JSON.stringify(pod.limits) : '-'],
          ['Metadata', pod.metadata ? JSON.stringify(pod.metadata) : '-'],
          ['Created At', pod.createdAt],
          ['Updated At', pod.updatedAt],
        ]);
        output.success(`Pod created: ${pod.id}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to create pod');
      }
    });
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to this organization.');
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
