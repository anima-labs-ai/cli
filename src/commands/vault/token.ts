import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { ApiError } from '../../lib/api-client.js';
import { exchangeVaultToken } from '../../lib/secret-ref.js';

type TokenScope = 'autofill' | 'proxy' | 'export';

function validateScope(value: string): TokenScope {
  if (value === 'autofill' || value === 'proxy' || value === 'export') return value;
  throw new InvalidArgumentError('scope must be one of autofill, proxy, export');
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
    .option('--scope <scope>', 'Token scope: autofill, proxy, export', validateScope, 'autofill' as TokenScope)
    .option('--ttl <seconds>', 'TTL in seconds (10-3600, default 60)')
    .action(async function (this: Command) {
      const opts = this.opts<TokenCreateOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.createToken({
          agentId: opts.agent,
          credentialId: opts.credential,
          scope: opts.scope,
          ttlSeconds: opts.ttl ? Number(opts.ttl) : undefined,
        });

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
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else {
            output.error(`Failed to create token: ${error.message}`);
          }
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
      const output = Output.fromGlobals(globals);

      try {
        // Raw /v1 path — stable across the server-side rename to
        // exchangeTokenForInjection, so no contracts-pin dependency.
        const client = await requireAuth(globals);
        const result = await exchangeVaultToken(client, opts.vtk);

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
        if (error instanceof ORPCError || error instanceof ApiError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else if (error.status === 403) {
            output.error(
              'Token exchange is gated to injector credentials: use a master key, or grant this key the vault:inject scope. Agents should prefer `anima vault use` (server-side broker).',
            );
          } else if (error.status === 404 || error.status === 410) {
            output.error('Token is invalid, expired, or already used.');
          } else {
            output.error(`Failed to exchange token: ${error.message}`);
          }
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
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.revokeTokens({
          agentId: opts.agent,
          credentialId: opts.credential,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Revoked ${result.revoked} token(s)`);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else {
            output.error(`Failed to revoke tokens: ${error.message}`);
          }
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
