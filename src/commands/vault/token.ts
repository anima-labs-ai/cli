import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type TokenScope = 'autofill' | 'proxy' | 'export';

interface TokenResult {
  token: string;
  credentialId: string;
  scope: TokenScope;
  expiresAt: string;
}

interface VaultCredential {
  id: string;
  type: string;
  name: string;
}

// ---------------------------------------------------------------------------
// vault token create
// ---------------------------------------------------------------------------

interface TokenCreateOptions {
  agent?: string;
  credential: string;
  scope: TokenScope;
  ttl?: string;
}

function tokenCreateCommand(): Command {
  return new Command('create')
    .description('Create an ephemeral vault token')
    .option('--agent <id>', 'Agent ID')
    .requiredOption('--credential <id>', 'Credential ID')
    .option('--scope <scope>', 'Token scope: autofill, proxy, export', 'autofill')
    .option('--ttl <seconds>', 'TTL in seconds (10-3600, default 60)')
    .action(async function (this: Command) {
      const opts = this.opts<TokenCreateOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const body: Record<string, unknown> = {
          agentId: opts.agent,
          credentialId: opts.credential,
          scope: opts.scope,
        };
        if (opts.ttl) body.ttlSeconds = Number(opts.ttl);

        const result = await client.post<TokenResult>('/vault/token', body);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success('Created ephemeral token');
        output.details([
          ['Token', result.token],
          ['Scope', result.scope],
          ['Credential', result.credentialId],
          ['Expires', result.expiresAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to create token: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to create token: ${error.message}`);
        }
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// vault token exchange
// ---------------------------------------------------------------------------

interface TokenExchangeOptions {
  vtk: string;
}

function tokenExchangeCommand(): Command {
  return new Command('exchange')
    .description('Exchange an ephemeral token for credential data')
    .requiredOption('--vtk <vtk_token>', 'The vtk_ token to exchange')
    .action(async function (this: Command) {
      const opts = this.opts<TokenExchangeOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.post<VaultCredential>('/vault/token/exchange', {
          token: opts.vtk,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success('Exchanged token for credential');
        output.details([
          ['Credential ID', result.id],
          ['Type', result.type],
          ['Name', result.name],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to exchange token: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to exchange token: ${error.message}`);
        }
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// vault token revoke
// ---------------------------------------------------------------------------

interface TokenRevokeOptions {
  agent?: string;
  credential: string;
}

function tokenRevokeCommand(): Command {
  return new Command('revoke')
    .description('Revoke all tokens for a credential')
    .option('--agent <id>', 'Agent ID')
    .requiredOption('--credential <id>', 'Credential ID')
    .action(async function (this: Command) {
      const opts = this.opts<TokenRevokeOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.post<{ success: boolean; revoked: number }>(
          '/vault/token/revoke',
          {
            agentId: opts.agent,
            credentialId: opts.credential,
          },
        );

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Revoked ${result.revoked} token(s)`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to revoke tokens: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to revoke tokens: ${error.message}`);
        }
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// vault token (parent)
// ---------------------------------------------------------------------------

export function tokenCommand(): Command {
  const cmd = new Command('token').description('Manage ephemeral vault tokens');
  cmd.addCommand(tokenCreateCommand());
  cmd.addCommand(tokenExchangeCommand());
  cmd.addCommand(tokenRevokeCommand());
  return cmd;
}
