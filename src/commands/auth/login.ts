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
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

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

  const result = await client.get<{ email: string }>('/auth/me');

  await saveAuthConfig({
    apiKey,
    apiUrl,
    email: result.email,
  });

  output.success(`Authenticated via API key as ${result.email}`);
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
