import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError, type ApiClient } from '../../lib/api-client.js';
import { boundedInt, requireNonEmptyArg } from '../../lib/args.js';

const CREDENTIAL_TYPES = [
  'login',
  'secure_note',
  'card',
  'identity',
  'oauth_token',
  'api_key',
  'certificate',
] as const;
type CredentialType = (typeof CREDENTIAL_TYPES)[number];

function validateType(value: string): CredentialType {
  if ((CREDENTIAL_TYPES as readonly string[]).includes(value)) {
    return value as CredentialType;
  }
  throw new InvalidArgumentError(`type must be one of ${CREDENTIAL_TYPES.join(', ')}`);
}

function validatePositiveInt(name: string) {
  return (value: string): number => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new InvalidArgumentError(`${name} must be a positive integer`);
    }
    return parsed;
  };
}

type RequestStatus = 'PENDING' | 'FULFILLED' | 'EXPIRED' | 'DECLINED' | 'CANCELLED';

interface CredentialRequestResponse {
  requestId: string;
  fillUrl: string;
  status: RequestStatus;
  expiresAt: string;
  emailSent: boolean;
  credentialId?: string | null;
}

interface CredentialRequestStatusResponse {
  status: RequestStatus;
  credentialId: string | null;
  maskedPreview: string | null;
}

function handleRequestError(output: Output, error: unknown, action: string): never {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Credential request not found (it may have expired).');
    } else {
      output.error(`Failed to ${action}: ${error.message}`);
    }
  } else if (error instanceof Error) {
    output.error(`Failed to ${action}: ${error.message}`);
  }
  process.exit(1);
}

async function pollUntilTerminal(
  client: ApiClient,
  requestId: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<CredentialRequestStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await client.get<CredentialRequestStatusResponse>(
      `/v1/vault/credential-requests/${encodeURIComponent(requestId)}`,
    );
    if (state.status !== 'PENDING') return state;
    if (Date.now() >= deadline) return state;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

function printStatus(output: Output, state: CredentialRequestStatusResponse): void {
  output.details([
    ['Status', state.status],
    ['Credential', state.credentialId ?? '(not yet)'],
    ['Preview', state.maskedPreview ?? '(none)'],
  ]);
}

// ---------------------------------------------------------------------------
// vault request create
// ---------------------------------------------------------------------------

interface RequestCreateOptions {
  agent?: string;
  type: CredentialType;
  name: string;
  reason: string;
  ttl?: number;
  notifyOwner?: boolean;
  wait?: boolean;
  timeout: number;
  pollInterval: number;
}

function requestCreateCommand(): Command {
  return new Command('create')
    .description('Ask a human for a credential the agent never sees (returns a fill URL)')
    .option('--agent <id>', 'Agent ID (optional with an agent-bound key)')
    .requiredOption('--type <type>', `Credential type: ${CREDENTIAL_TYPES.join(', ')}`, validateType)
    .requiredOption('--name <name>', 'Display name for the credential to be created')
    .requiredOption('--reason <reason>', 'Why the credential is needed (shown to the owner)')
    .option('--ttl <seconds>', 'Request TTL in seconds (60-3600, default 900)', boundedInt('ttl', 60, 3600))
    .option('--notify-owner', 'Email the fill URL to the org owner')
    .option('--wait', 'Poll until the request is fulfilled, declined, or expires')
    .option('--timeout <seconds>', 'Max seconds to wait with --wait (default 900)', validatePositiveInt('timeout'), 900)
    .option('--poll-interval <ms>', 'Poll interval in ms with --wait (default 5000)', validatePositiveInt('poll-interval'), 5000)
    .action(async function (this: Command) {
      const opts = this.opts<RequestCreateOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const client = await requireAuth(globals);
        const created = await client.post<CredentialRequestResponse>(
          '/v1/vault/credential-requests',
          {
            agentId: opts.agent,
            type: opts.type,
            name: opts.name,
            reason: opts.reason,
            ttlSeconds: opts.ttl,
            notifyOwner: opts.notifyOwner,
          },
        );

        if (!opts.wait) {
          if (globals.json) {
            output.json(created);
            return;
          }
          output.success('Created credential request');
          output.details([
            ['Request', created.requestId],
            ['Status', created.status],
            ['Fill URL', created.fillUrl],
            ['Expires', created.expiresAt],
            ['Owner emailed', created.emailSent ? 'yes' : 'no'],
          ]);
          output.warn('Share the fill URL with the human who holds the secret.');
          return;
        }

        if (!globals.json) {
          output.success(`Created credential request ${created.requestId}`);
          output.details([['Fill URL', created.fillUrl]]);
        }
        const state = await pollUntilTerminal(
          client,
          created.requestId,
          opts.timeout * 1000,
          opts.pollInterval,
        );
        if (globals.json) {
          output.json({ ...state, requestId: created.requestId, fillUrl: created.fillUrl });
        } else {
          if (state.status === 'FULFILLED') {
            output.success('Request fulfilled — use the credential by reference; the secret stays in the vault');
          } else if (state.status === 'PENDING') {
            output.warn(`Timed out waiting; the request is still pending until ${created.expiresAt}`);
          } else {
            output.warn(`Request ended ${state.status}`);
          }
          printStatus(output, state);
        }
        // Exit code must reflect the terminal outcome REGARDLESS of output
        // format, so an agent can gate on `... create --wait --json && next`:
        // a DECLINED / EXPIRED / CANCELLED / timeout has to be a non-zero exit,
        // or the agent proceeds as if the human approved.
        if (state.status !== 'FULFILLED') process.exit(1);
      } catch (error: unknown) {
        handleRequestError(output, error, 'create credential request');
      }
    });
}

// ---------------------------------------------------------------------------
// vault request status
// ---------------------------------------------------------------------------

interface RequestStatusOptions {
  wait?: boolean;
  timeout: number;
  pollInterval: number;
}

function requestStatusCommand(): Command {
  return new Command('status')
    .description('Check a credential request (returns a masked preview, never the secret)')
    .argument('<requestId>', 'Credential request ID', requireNonEmptyArg('Credential request ID'))
    .option('--wait', 'Poll until the request leaves PENDING')
    .option('--timeout <seconds>', 'Max seconds to wait with --wait (default 900)', validatePositiveInt('timeout'), 900)
    .option('--poll-interval <ms>', 'Poll interval in ms with --wait (default 5000)', validatePositiveInt('poll-interval'), 5000)
    .action(async function (this: Command, requestId: string) {
      const opts = this.opts<RequestStatusOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const client = await requireAuth(globals);
        const state = opts.wait
          ? await pollUntilTerminal(client, requestId, opts.timeout * 1000, opts.pollInterval)
          : await client.get<CredentialRequestStatusResponse>(
              `/v1/vault/credential-requests/${encodeURIComponent(requestId)}`,
            );

        if (globals.json) {
          output.json(state);
          return;
        }
        printStatus(output, state);
      } catch (error: unknown) {
        handleRequestError(output, error, 'get credential request status');
      }
    });
}

// ---------------------------------------------------------------------------
// vault request cancel
// ---------------------------------------------------------------------------

function requestCancelCommand(): Command {
  return new Command('cancel')
    .description('Cancel a pending credential request (invalidates its fill URL)')
    .argument('<requestId>', 'Credential request ID', requireNonEmptyArg('Credential request ID'))
    .action(async function (this: Command, requestId: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const client = await requireAuth(globals);
        const result = await client.post<{ status: RequestStatus }>(
          `/v1/vault/credential-requests/${encodeURIComponent(requestId)}/cancel`,
        );

        if (globals.json) {
          output.json(result);
          return;
        }
        output.success(`Credential request ${result.status.toLowerCase()}`);
      } catch (error: unknown) {
        handleRequestError(output, error, 'cancel credential request');
      }
    });
}

// ---------------------------------------------------------------------------
// vault request (parent)
// ---------------------------------------------------------------------------

export function requestCommand(): Command {
  const cmd = new Command('request').description(
    'Human-in-the-loop credential requests — a human supplies the secret out-of-band',
  );
  cmd.addCommand(requestCreateCommand());
  cmd.addCommand(requestStatusCommand());
  cmd.addCommand(requestCancelCommand());
  return cmd;
}
