import { Command } from 'commander';
import { ApiClient, ApiError } from '../../lib/api-client.js';
import { saveAuthConfig } from '../../lib/config.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions, resolveApiUrl } from '../../lib/auth.js';

interface LoginResponse {
  token: string;
  refreshToken: string;
  expiresAt: string;
  email: string;
}

interface LoginOptions {
  email?: string;
  password?: string;
  apiKey?: string;
}

export function loginCommand(): Command {
  return new Command('login')
    .description('Authenticate with Anima')
    .option('-e, --email <email>', 'Email address')
    .option('-p, --password <password>', 'Password')
    .option('-k, --api-key <key>', 'API key (alternative to email/password)')
    .action(async function (this: Command) {
      const opts = this.opts<LoginOptions>();
      const globals = this.optsWithGlobals<LoginOptions & GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        if (opts.apiKey) {
          await loginWithApiKey(opts.apiKey, globals, output);
        } else if (opts.email && opts.password) {
          await loginWithCredentials(opts.email, opts.password, globals, output);
        } else {
          output.error('Provide --email and --password, or --api-key');
          process.exit(1);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Login failed: ${error.message} (${error.status})`);
        } else if (error instanceof Error) {
          output.error(`Login failed: ${error.message}`);
        }
        process.exit(1);
      }
    });
}

async function loginWithApiKey(
  apiKey: string,
  globals: GlobalOptions,
  output: Output,
): Promise<void> {
  const apiUrl = resolveApiUrl(globals);
  const client = new ApiClient({
    baseUrl: apiUrl,
    apiKey,
    debug: globals.debug,
  });

  // `/orgs/me` validates the API key and returns the org. We use it as a
  // 200-OK probe + identity surface; `/auth/me` was the historical name and
  // never existed in prod.
  const result = await client.get<{ id: string; name: string; slug: string }>('/orgs/me');

  await saveAuthConfig({
    apiKey,
    apiUrl,
    // The org slug is the closest stable identifier we have without a user
    // record. Stored as `email` in the config for backward compat with
    // existing config files (the field name is a misnomer at this point).
    email: result.slug,
  });

  output.success(`Authenticated via API key for org ${result.name}`);
}

async function loginWithCredentials(
  email: string,
  password: string,
  globals: GlobalOptions,
  output: Output,
): Promise<void> {
  const apiUrl = resolveApiUrl(globals);
  const client = new ApiClient({
    baseUrl: apiUrl,
    debug: globals.debug,
  });

  const result = await client.post<LoginResponse>('/auth/login', { email, password });

  await saveAuthConfig({
    token: result.token,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
    apiUrl,
    email: result.email,
  });

  output.success(`Logged in as ${result.email}`);
}
