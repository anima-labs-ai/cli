import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type UseMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

function validateMethod(value: string): UseMethod {
  const method = value.toUpperCase();
  if (
    method === 'GET' ||
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE' ||
    method === 'HEAD'
  ) {
    return method;
  }
  throw new InvalidArgumentError('method must be one of GET, POST, PUT, PATCH, DELETE, HEAD');
}

function collectHeader(value: string, previous: Record<string, string>): Record<string, string> {
  const idx = value.indexOf(':');
  if (idx === -1) {
    throw new InvalidArgumentError(`header must be "Name: value", got "${value}"`);
  }
  const name = value.slice(0, idx).trim();
  const headerValue = value.slice(idx + 1).trim();
  if (!name) {
    throw new InvalidArgumentError(`header must be "Name: value", got "${value}"`);
  }
  return { ...previous, [name]: headerValue };
}

interface UseOptions {
  agent?: string;
  credential: string;
  method: UseMethod;
  url: string;
  header: Record<string, string>;
  body?: string;
}

interface UseCredentialResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

/**
 * Server-side broker: the API makes the outbound call and injects the
 * credential there, so the plaintext never reaches this machine — unlike
 * `vault exec`/`vault proxy`, which inject into a local process. Requires
 * the credential to have broker-allowed hosts (apiKey/oauth allowedHosts
 * or login URIs) and, for scoped keys, the `vault:use` scope.
 */
export function useCommand(): Command {
  return new Command('use')
    .description('Call an API with a credential attached server-side (secret never leaves Anima)')
    .option('--agent <id>', 'Agent ID (optional with an agent-bound key)')
    .requiredOption('--credential <id>', 'Credential ID to broker the call with')
    .option('--method <method>', 'HTTP method: GET, POST, PUT, PATCH, DELETE, HEAD', validateMethod, 'GET' as UseMethod)
    .requiredOption('--url <url>', 'Absolute https:// URL (host must be on the credential allowlist)')
    .option('-H, --header <header>', 'Extra request header "Name: value" (repeatable; auth headers are replaced by the credential)', collectHeader, {})
    .option('--body <body>', 'Raw request body (encode JSON yourself)')
    .action(async function (this: Command) {
      const opts = this.opts<UseOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const client = await requireAuth(globals);
        const result = await client.post<UseCredentialResponse>(
          `/v1/vault/credentials/${encodeURIComponent(opts.credential)}/use`,
          {
            agentId: opts.agent,
            method: opts.method,
            url: opts.url,
            headers: Object.keys(opts.header).length > 0 ? opts.header : undefined,
            body: opts.body,
          },
        );

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Upstream responded ${result.status}`);
        if (result.truncated) {
          output.warn('Response body was truncated (size cap)');
        }
        if (result.body) {
          console.log(result.body);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else if (error.status === 403) {
            output.error(
              `Access denied: ${error.message} (scoped keys need the vault:use scope; the caller needs USE access to the credential)`,
            );
          } else if (error.status === 429) {
            output.error(`Rate limited: ${error.message}`);
          } else {
            output.error(`Broker call failed: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Broker call failed: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
