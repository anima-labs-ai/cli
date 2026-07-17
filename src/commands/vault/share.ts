import { Command, InvalidArgumentError } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

type SharePermission = 'READ' | 'USE' | 'MANAGE';

function validatePermission(value: string): SharePermission {
  if (value === 'READ' || value === 'USE' || value === 'MANAGE') return value;
  throw new InvalidArgumentError('permission must be one of READ, USE, MANAGE');
}

// ---------------------------------------------------------------------------
// vault share create
// ---------------------------------------------------------------------------

interface ShareCreateOptions {
  agent: string;
  credential: string;
  target: string;
  permission: SharePermission;
  ttl?: string;
}

function shareCreateCommand(): Command {
  return new Command('create')
    .description('Share a credential with another agent')
    .requiredOption('--agent <id>', 'Source agent ID (the agent granting access)', requireNonEmptyArg('Source agent ID'))
    .requiredOption('--credential <id>', 'Credential ID to share', requireNonEmptyArg('Credential ID'))
    .requiredOption('--target <id>', 'Target agent ID (the agent receiving access)', requireNonEmptyArg('Target agent ID'))
    .option(
      '--permission <perm>',
      'READ = view metadata only; USE = fetch for runtime use; MANAGE = view + update + re-share',
      validatePermission,
      'READ' as SharePermission,
    )
    .option('--ttl <seconds>', 'Share TTL in seconds (omit for never-expiring share)')
    .action(async function (this: Command) {
      const opts = this.opts<ShareCreateOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        // Contract field is `sourceAgentId` — `agentId` was the old name and is no
        // longer accepted by the API. Keep the CLI flag `--agent` for ergonomics.
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.share({
          credentialId: opts.credential,
          sourceAgentId: opts.agent,
          targetAgentId: opts.target,
          permission: opts.permission,
          expiresInSeconds: opts.ttl ? Number(opts.ttl) : undefined,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Shared credential with agent ${opts.target}`);
        output.details([
          ['Share ID', result.id],
          ['Credential', result.credentialId],
          ['Source Agent', result.sourceAgentId],
          ['Target Agent', result.targetAgentId],
          ['Permission', result.permission],
          ['Expires', result.expiresAt ?? 'Never'],
        ]);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else {
            output.error(`Failed to share credential: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to share credential: ${error.message}`);
        }
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// vault share list
// ---------------------------------------------------------------------------

interface ShareListOptions {
  agent?: string;
  direction: 'granted' | 'received';
}

function validateDirection(value: string): 'granted' | 'received' {
  if (value === 'granted' || value === 'received') return value;
  throw new InvalidArgumentError('direction must be "granted" or "received"');
}

function shareListCommand(): Command {
  return new Command('list')
    .description('List credential shares')
    .option('--agent <id>', 'Agent ID')
    .option('--direction <dir>', 'Direction: granted or received', validateDirection, 'received')
    .action(async function (this: Command) {
      const opts = this.opts<ShareListOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.listShares({
          agentId: opts.agent,
          direction: opts.direction,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['Share ID', 'Credential', 'Source', 'Target', 'Permission', 'Expires'],
          result.items.map((s) => [
            s.id,
            s.credentialId,
            s.sourceAgentId,
            s.targetAgentId,
            s.permission,
            s.expiresAt ?? 'Never',
          ]),
        );
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else {
            output.error(`Failed to list shares: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to list shares: ${error.message}`);
        }
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// vault share revoke
// ---------------------------------------------------------------------------

interface ShareRevokeOptions {
  id: string;
  agent?: string;
}

function shareRevokeCommand(): Command {
  return new Command('revoke')
    .description('Revoke a credential share')
    .requiredOption('--id <shareId>', 'Share ID to revoke', requireNonEmptyArg('Share ID'))
    .option('--agent <id>', 'Agent ID that owns the share')
    .action(async function (this: Command) {
      const opts = this.opts<ShareRevokeOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.revokeShare({
          shareId: opts.id,
          agentId: opts.agent,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Revoked share ${opts.id}`);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else if (error.status === 404) {
            output.error('Share not found.');
          } else {
            output.error(`Failed to revoke share: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to revoke share: ${error.message}`);
        }
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// vault share (parent)
// ---------------------------------------------------------------------------

export function shareCommand(): Command {
  const cmd = new Command('share').description('Manage credential sharing between agents');
  cmd.addCommand(shareCreateCommand());
  cmd.addCommand(shareListCommand());
  cmd.addCommand(shareRevokeCommand());
  return cmd;
}
