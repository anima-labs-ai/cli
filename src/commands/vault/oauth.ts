import { Command } from 'commander';
import { execFile } from 'child_process';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface OAuthApp {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  authMethod: string;
  defaultScopes: string[];
  category: string | null;
  isManaged: boolean;
}

interface ConnectedAccount {
  id: string;
  appSlug: string;
  appName: string;
  accountEmail: string | null;
  accountLabel: string | null;
  status: string;
  grantedScopes: string[];
  userId: string | null;
  tokenExpiresAt: string | null;
  lastRefreshedAt: string | null;
  createdAt: string;
}

interface ConnectLinkResponse {
  linkUrl: string;
  token: string;
  expiresAt: string;
}

export function oauthCommand(): Command {
  const cmd = new Command('oauth')
    .description('Manage OAuth connections for agent authentication');

  // --- am vault oauth apps ---
  cmd
    .command('apps')
    .description('List available OAuth services')
    .option('--category <category>', 'Filter by category')
    .action(async function (this: Command) {
      const opts = this.opts<{ category?: string }>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const query: Record<string, string> = {};
        if (opts.category) query.category = opts.category;
        const result = await client.get<{ items: OAuthApp[] }>('/vault/oauth/apps', query);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['Slug', 'Name', 'Auth', 'Category', 'Managed'],
          result.items.map((app) => [
            app.slug,
            app.name,
            app.authMethod,
            app.category || '-',
            app.isManaged ? 'Yes' : 'No',
          ]),
        );
      } catch (error: unknown) {
        output.error(`Failed to list OAuth apps: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // --- am vault oauth connect <slug> ---
  cmd
    .command('connect')
    .description('Connect to an OAuth service (opens browser)')
    .argument('<slug>', 'Service slug (e.g. google, github, slack)')
    .option('--agent <id>', 'Agent ID')
    .option('--user <id>', 'User ID (multi-tenant)')
    .option('--scopes <scopes>', 'Override scopes (comma-separated)')
    .action(async function (this: Command, slug: string) {
      const opts = this.opts<{ agent?: string; user?: string; scopes?: string }>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const body: Record<string, unknown> = { appSlug: slug };
        if (opts.agent) body.agentId = opts.agent;
        if (opts.user) body.userId = opts.user;
        if (opts.scopes) body.scopes = opts.scopes.split(',').map((s) => s.trim());

        const result = await client.post<ConnectLinkResponse>('/vault/oauth/link', body);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Connect Link created for ${slug}`);
        output.info(`URL: ${result.linkUrl}`);
        output.info(`Expires: ${result.expiresAt}`);
        output.info('Open this URL in your browser to complete authentication.');

        // Try to open in default browser using safe execFile
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
        const openArgs = process.platform === 'win32' ? ['/c', 'start', result.linkUrl] : [result.linkUrl];
        execFile(openCmd, openArgs, () => { /* ignore errors — user can copy URL manually */ });
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to create Connect Link: ${error.message}`);
        } else {
          output.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        process.exit(1);
      }
    });

  // --- am vault oauth accounts ---
  cmd
    .command('accounts')
    .description('List connected OAuth accounts')
    .option('--agent <id>', 'Agent ID')
    .option('--user <id>', 'Filter by user ID')
    .option('--app <slug>', 'Filter by service slug')
    .option('--status <status>', 'Filter by status')
    .action(async function (this: Command) {
      const opts = this.opts<{ agent?: string; user?: string; app?: string; status?: string }>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const query: Record<string, string> = {};
        if (opts.agent) query.agentId = opts.agent;
        if (opts.user) query.userId = opts.user;
        if (opts.app) query.appSlug = opts.app;
        if (opts.status) query.status = opts.status;

        const result = await client.get<{ items: ConnectedAccount[] }>('/vault/oauth/accounts', query);

        if (globals.json) {
          output.json(result);
          return;
        }

        if (result.items.length === 0) {
          output.info('No connected accounts found.');
          return;
        }

        output.table(
          ['ID', 'Service', 'Account', 'Status', 'User', 'Scopes'],
          result.items.map((a) => [
            a.id.slice(0, 12) + '...',
            a.appName,
            a.accountEmail || a.accountLabel || '-',
            a.status,
            a.userId || '-',
            a.grantedScopes.slice(0, 3).join(', ') + (a.grantedScopes.length > 3 ? '...' : ''),
          ]),
        );
      } catch (error: unknown) {
        output.error(`Failed to list accounts: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // --- am vault oauth disconnect <accountId> ---
  cmd
    .command('disconnect')
    .description('Disconnect an OAuth account')
    .argument('<accountId>', 'Connected account ID')
    .option('--agent <id>', 'Agent ID')
    .action(async function (this: Command, accountId: string) {
      const opts = this.opts<{ agent?: string }>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const query: Record<string, string> = {};
        if (opts.agent) query.agentId = opts.agent;
        await client.delete(`/vault/oauth/accounts/${accountId}`, query);
        output.success(`Disconnected account ${accountId}`);
      } catch (error: unknown) {
        output.error(`Failed to disconnect: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // --- am vault oauth custom ---
  const customCmd = new Command('custom')
    .description('Manage custom OAuth apps (BYOA - Bring Your Own App)');

  customCmd
    .command('create')
    .description('Register a custom OAuth app for branded consent screens')
    .argument('<slug>', 'Service slug (e.g. google, github, slack)')
    .requiredOption('--client-id <id>', 'Your OAuth client ID')
    .requiredOption('--client-secret <secret>', 'Your OAuth client secret')
    .option('--scopes <scopes>', 'Custom scopes (comma-separated)')
    .action(async function (this: Command, slug: string) {
      const opts = this.opts<{ clientId: string; clientSecret: string; scopes?: string }>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const body: Record<string, unknown> = {
          appSlug: slug,
          clientId: opts.clientId,
          clientSecret: opts.clientSecret,
        };
        if (opts.scopes) body.customScopes = opts.scopes.split(',').map((s) => s.trim());

        const result = await client.post<{ id: string; appSlug: string; clientId: string }>(
          `/vault/oauth/apps/${slug}/custom`,
          body,
        );

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Custom OAuth app created for ${slug}`);
        output.details([
          ['Custom App ID', result.id],
          ['Service', result.appSlug],
          ['Client ID', result.clientId],
        ]);
      } catch (error: unknown) {
        output.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  customCmd
    .command('delete')
    .description('Delete a custom OAuth app')
    .argument('<slug>', 'Service slug')
    .argument('<id>', 'Custom app ID')
    .action(async function (this: Command, slug: string, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        await client.delete(`/vault/oauth/apps/${slug}/custom/${id}`);
        output.success(`Custom OAuth app ${id} deleted`);
      } catch (error: unknown) {
        output.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  cmd.addCommand(customCmd);

  return cmd;
}
