import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type SharePermission = 'READ' | 'USE' | 'MANAGE';

interface ShareResult {
  id: string;
  credentialId: string;
  sourceAgentId: string;
  targetAgentId: string;
  permission: SharePermission;
  expiresAt: string | null;
  createdAt: string;
}

interface ListSharesResult {
  items: ShareResult[];
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
    .requiredOption('--agent <id>', 'Source agent ID')
    .requiredOption('--credential <id>', 'Credential ID to share')
    .requiredOption('--target <id>', 'Target agent ID')
    .option('--permission <perm>', 'Permission level (READ, USE, MANAGE)', 'READ')
    .option('--ttl <seconds>', 'Optional share TTL in seconds')
    .action(async function (this: Command) {
      const opts = this.opts<ShareCreateOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const body: Record<string, unknown> = {
          agentId: opts.agent,
          credentialId: opts.credential,
          targetAgentId: opts.target,
          permission: opts.permission,
        };
        if (opts.ttl) body.expiresInSeconds = Number(opts.ttl);

        const result = await client.post<ShareResult>('/vault/share', body);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Shared credential with agent ${opts.target}`);
        output.details([
          ['Share ID', result.id],
          ['Credential', result.credentialId],
          ['Target Agent', result.targetAgentId],
          ['Permission', result.permission],
          ['Expires', result.expiresAt ?? 'Never'],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to share credential: ${error.message}`);
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
  agent: string;
  direction: 'granted' | 'received';
}

function shareListCommand(): Command {
  return new Command('list')
    .description('List credential shares')
    .requiredOption('--agent <id>', 'Agent ID')
    .option('--direction <dir>', 'Direction: granted or received', 'received')
    .action(async function (this: Command) {
      const opts = this.opts<ShareListOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<ListSharesResult>('/vault/shares', {
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
        if (error instanceof ApiError) {
          output.error(`Failed to list shares: ${error.message}`);
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
  agent: string;
}

function shareRevokeCommand(): Command {
  return new Command('revoke')
    .description('Revoke a credential share')
    .requiredOption('--id <shareId>', 'Share ID to revoke')
    .requiredOption('--agent <id>', 'Agent ID that owns the share')
    .action(async function (this: Command) {
      const opts = this.opts<ShareRevokeOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        await client.post('/vault/share/revoke', {
          shareId: opts.id,
          agentId: opts.agent,
        });

        if (globals.json) {
          output.json({ success: true });
          return;
        }

        output.success(`Revoked share ${opts.id}`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to revoke share: ${error.message}`);
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
