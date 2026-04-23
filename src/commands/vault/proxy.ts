import { Command } from 'commander';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { resolveSecretRefs, loadAnimaConfig, type SecretRef } from '../../lib/secret-ref.js';

interface ProxyOptions {
  agent?: string;
  port?: string;
  cred?: string;
  header?: string;
  scheme?: string;
  allowHost?: string[];
}

/**
 * `am vault proxy` — local HTTPS proxy that injects an Authorization header
 * from a vault credential into outbound requests. The agent never sees the
 * token; it only ever holds the short-lived proxy token for this run.
 *
 * Usage pattern:
 *    $ am vault proxy --cred cred_github --allow-host api.github.com --port 19840 &
 *    => prints: proxy_token=pxt_abcd1234  port=19840
 *    $ curl -H "X-Anima-Proxy: pxt_abcd1234" http://localhost:19840/https://api.github.com/user
 *
 * Security model:
 *   - Proxy only forwards to hosts on the --allow-host list (no wildcard).
 *   - Proxy token is ephemeral, per-run, and never returned in any response body.
 *   - Incoming requests must present X-Anima-Proxy: <token> or are rejected.
 *   - Upstream response bodies are streamed through unchanged (no buffering of secrets).
 */
export function proxyCommand(): Command {
  return new Command('proxy')
    .description('Run a local proxy that injects a vault credential into outbound requests')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .option('--port <port>', 'Port to listen on (default 19840)', '19840')
    .requiredOption('--cred <ref>', 'Credential reference: cred_id or anima.json key')
    .option('--header <name>', 'Header name to inject (default: Authorization)', 'Authorization')
    .option('--scheme <scheme>', 'Scheme prefix (e.g. "Bearer ", "Token "). Default "Bearer ".', 'Bearer ')
    .option(
      '--allow-host <host>',
      'Host to forward to (repeatable). Requests to other hosts are rejected.',
      (value, previous: string[] = []) => [...previous, value],
    )
    .action(async function (this: Command) {
      const opts = this.opts<ProxyOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const allowHosts = new Set(opts.allowHost ?? []);
      if (allowHosts.size === 0) {
        output.error('--allow-host is required (and repeatable). Refusing to run an open proxy.');
        process.exit(2);
      }

      try {
        const client = await requireAuth(globals);

        // Resolve the credential once at startup. If the secret rotates, the
        // user re-runs the proxy — matches OpenClaw's "reload after rotation".
        const { config } = await loadAnimaConfig();
        let ref: SecretRef;
        if (config.secrets && opts.cred && config.secrets[opts.cred]) {
          ref = config.secrets[opts.cred];
        } else if (opts.cred && opts.cred.startsWith('cred_')) {
          ref = { source: 'anima', credentialId: opts.cred, field: 'apiKey.key', agentId: opts.agent };
        } else {
          output.error(`--cred "${opts.cred}" not found in anima.json and is not a credential ID`);
          return process.exit(2);
        }

        const { values, errors } = await resolveSecretRefs(client, { secret: ref });
        if (errors.length > 0) {
          output.error(`Failed to resolve credential: ${errors[0].reason}`);
          process.exit(1);
        }
        const secret = values.secret;

        // Mint a proxy token that the agent (or curl) will present to us.
        const proxyToken = `pxt_${crypto.randomBytes(16).toString('hex')}`;
        const port = Number(opts.port) || 19840;

        const server = http.createServer((req, res) => {
          // 1. Auth check.
          const presented = req.headers['x-anima-proxy'];
          if (presented !== proxyToken) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'missing or invalid X-Anima-Proxy token' }));
            return;
          }

          // 2. Parse the target URL from the path: /https://host/path?q=1
          if (!req.url) {
            res.writeHead(400);
            res.end();
            return;
          }
          const target = req.url.slice(1); // strip leading slash
          let url: URL;
          try {
            url = new URL(target);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'path must be a full URL, e.g. /https://api.github.com/user' }));
            return;
          }

          // 3. Allowlist check.
          if (!allowHosts.has(url.hostname)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `host not allowed: ${url.hostname}` }));
            return;
          }

          // 4. Forward with injected header.
          const headerName = opts.header ?? 'Authorization';
          const headers: http.OutgoingHttpHeaders = { ...req.headers };
          delete headers['x-anima-proxy']; // never leak our ceremony token upstream
          delete headers.host;
          headers[headerName.toLowerCase()] = `${opts.scheme ?? 'Bearer '}${secret}`;

          const upstreamLib = url.protocol === 'https:' ? https : http;
          const upstreamReq = upstreamLib.request(
            {
              hostname: url.hostname,
              port: url.port || (url.protocol === 'https:' ? 443 : 80),
              path: url.pathname + url.search,
              method: req.method,
              headers,
            },
            (upstreamRes) => {
              res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
              upstreamRes.pipe(res);
            },
          );
          upstreamReq.on('error', (err) => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `upstream error: ${err.message}` }));
          });
          req.pipe(upstreamReq);
        });

        // Bind to loopback only — this proxy must never be reachable from the network.
        server.listen(port, '127.0.0.1', () => {
          if (globals.json) {
            output.json({ proxyToken, port, allowHosts: [...allowHosts] });
          } else {
            output.success(`Proxy listening on 127.0.0.1:${port}`);
            output.info(`proxy_token=${proxyToken}`);
            output.info(`Allowed hosts: ${[...allowHosts].join(', ')}`);
            output.info(`Example: curl -H "X-Anima-Proxy: ${proxyToken}" http://127.0.0.1:${port}/https://${[...allowHosts][0]}/...`);
          }
        });

        // Graceful shutdown.
        for (const sig of ['SIGINT', 'SIGTERM'] as const) {
          process.on(sig, () => {
            server.close(() => process.exit(0));
          });
        }
      } catch (error: unknown) {
        output.error(`proxy failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
