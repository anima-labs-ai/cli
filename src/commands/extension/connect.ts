import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

type ExtensionTokenTtl = '15m' | '1h' | 'session';

interface ConnectOptions {
  agent?: string;
  ttl?: ExtensionTokenTtl;
}

export function extensionConnectCommand(): Command {
  return new Command('connect')
    .description('Mint a headless extension connection URL for a Puppeteer-driven browser')
    .option(
      '--agent <id>',
      'Agent to bind the connection to (required with a master key; resolved automatically with an agent key)',
    )
    .option('--ttl <ttl>', 'Token TTL — one of 15m, 1h, session (shorten-only vs the org setting)')
    .action(async function (this: Command) {
      const opts = this.opts<ConnectOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        // Only send keys the caller actually set. With an agent API key the
        // server resolves the agent from the credential, so `agentId` must be
        // omitted; with a master key the contract requires it. `ttl` is
        // optional and shorten-only. There is no token/secret in the response.
        const input: { agentId?: string; ttl?: ExtensionTokenTtl } = {};
        if (opts.agent !== undefined) input.agentId = opts.agent;
        if (opts.ttl !== undefined) input.ttl = opts.ttl;

        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.extension.connect(input);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success('Extension connection ready');
        output.details([
          ['Connect URL', result.connectUrl],
          ['Agent', result.agentId],
          ['Policy', result.policy],
          ['Expires At', result.expiresAt ?? 'session (no expiry)'],
          ['Exchange Expires At', result.exchangeExpiresAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else {
            output.error(`Failed to connect extension: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to connect extension: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
