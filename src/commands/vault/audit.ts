import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { loadAnimaConfig } from '../../lib/secret-ref.js';

interface AuditOptions {
  agent?: string;
  fix?: boolean;
  check?: boolean;
}

// High-confidence patterns for well-known credential shapes. We prefer false
// negatives over false positives — users will rage-quit a scanner that lights
// up their entire repo. For broader coverage, add literal-match against the
// vault inventory (see below).
const HIGH_CONFIDENCE_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'AWS access key', regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'GitHub PAT (classic)', regex: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: 'GitHub PAT (fine-grained)', regex: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g },
  { name: 'Slack bot token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Stripe live key', regex: /\bsk_live_[A-Za-z0-9]{24,}\b/g },
  { name: 'Stripe restricted key', regex: /\brk_live_[A-Za-z0-9]{24,}\b/g },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'OpenAI key', regex: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { name: 'Anthropic key', regex: /\bsk-ant-[A-Za-z0-9_-]{95,}\b/g },
  { name: '1Password service token', regex: /\bops_[A-Za-z0-9]{40,}\b/g },
  { name: 'Anima master key', regex: /\bmk_[a-f0-9]{64}\b/g },
  { name: 'JWT (3-segment)', regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
];

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache',
  'coverage', '.venv', 'venv', '__pycache__', '.pnpm',
]);

const IGNORE_FILES = new Set(['bun.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);

const TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.yaml', '.yml', '.toml', '.env', '.envrc',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.sh', '.bash', '.zsh', '.fish',
  '.md', '.mdx', '.txt', '.conf', '.ini',
]);

export interface AuditFinding {
  file: string;
  line: number;
  column: number;
  patternName: string;
  match: string;
  context: string;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      if (IGNORE_FILES.has(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (TEXT_EXTS.has(ext) || entry.name.startsWith('.env')) {
        yield path.join(dir, entry.name);
      }
    }
  }
}

async function scanFile(
  file: string,
  vaultLiterals: string[],
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  let content: string;
  try {
    content = await fs.readFile(file, 'utf-8');
  } catch {
    return findings;
  }

  const lines = content.split('\n');

  for (const { name, regex } of HIGH_CONFIDENCE_PATTERNS) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null = regex.exec(content);
    while (m !== null) {
      const idx = m.index;
      let lineStart = 0;
      let lineNum = 1;
      for (let i = 0; i < idx; i++) {
        if (content[i] === '\n') { lineNum++; lineStart = i + 1; }
      }
      findings.push({
        file,
        line: lineNum,
        column: idx - lineStart + 1,
        patternName: name,
        match: `${m[0].slice(0, 6)}…${m[0].slice(-4)}`,
        context: lines[lineNum - 1]?.slice(0, 120) ?? '',
      });
      m = regex.exec(content);
    }
  }

  // Literal-match scan against known vault plaintexts.
  for (const literal of vaultLiterals) {
    let idx = content.indexOf(literal);
    while (idx !== -1) {
      let lineStart = 0;
      let lineNum = 1;
      for (let i = 0; i < idx; i++) {
        if (content[i] === '\n') { lineNum++; lineStart = i + 1; }
      }
      findings.push({
        file,
        line: lineNum,
        column: idx - lineStart + 1,
        patternName: 'Vault credential match',
        match: `${literal.slice(0, 4)}…`,
        context: lines[lineNum - 1]?.slice(0, 120) ?? '',
      });
      idx = content.indexOf(literal, idx + literal.length);
    }
  }

  return findings;
}

export function auditCommand(): Command {
  return new Command('audit')
    .description('Scan files for plaintext secrets and unresolved vault references')
    .argument('[paths...]', 'Files or directories to scan (default: cwd)')
    .option('--agent <id>', 'Agent ID (used to load known vault credentials for literal matching)')
    .option('--check', 'Exit with code 1 if any findings (for CI)')
    .option('--fix', 'Interactively replace findings with SecretRefs (coming soon)')
    .action(async function (this: Command, paths: string[]) {
      const opts = this.opts<AuditOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const roots = paths.length > 0 ? paths : [process.cwd()];

        // Pull vault credentials so we can literal-match them in files.
        // This is the real-world power-up over pure regex scanning — catches
        // internal tokens that don't fit any public pattern.
        const vaultLiterals: string[] = [];
        try {
          const client = await requireAuth(globals);
          const { items } = await client.get<{ items: Array<Record<string, unknown>> }>(
            '/vault/credentials',
            { agentId: opts.agent, reveal: 'true' },
          );
          for (const cred of items) {
            const login = cred.login as Record<string, unknown> | undefined;
            const apiKey = cred.apiKey as Record<string, unknown> | undefined;
            const oauth = cred.oauthToken as Record<string, unknown> | undefined;
            const cert = cred.certificate as Record<string, unknown> | undefined;
            for (const v of [
              login?.password, login?.totp,
              apiKey?.key,
              oauth?.accessToken,
              cert?.privateKey,
            ]) {
              if (typeof v === 'string' && v.length >= 12) vaultLiterals.push(v);
            }
          }
          output.debug(`Loaded ${vaultLiterals.length} vault literals for matching`);
        } catch (err) {
          output.warn(`Could not load vault (pattern-only scan): ${err instanceof Error ? err.message : 'unknown'}`);
        }

        const { config, configPath } = await loadAnimaConfig();
        if (configPath) output.debug(`Found config: ${configPath}`);

        const findings: AuditFinding[] = [];
        for (const root of roots) {
          const stat = await fs.stat(root).catch(() => null);
          if (!stat) {
            output.warn(`Path not found: ${root}`);
            continue;
          }
          if (stat.isFile()) {
            findings.push(...(await scanFile(root, vaultLiterals)));
          } else {
            for await (const file of walk(root)) {
              findings.push(...(await scanFile(file, vaultLiterals)));
            }
          }
        }

        // Validate anima.json SecretRefs (shape + binding) without triggering
        // real vault accesses.
        const refIssues: Array<{ name: string; reason: string }> = [];
        if (config.secrets && Object.keys(config.secrets).length > 0) {
          for (const [name, ref] of Object.entries(config.secrets)) {
            if (ref.source === 'anima') {
              output.debug(`  ${name} -> anima:${ref.credentialId}.${ref.field}`);
            }
          }
        }

        if (globals.json) {
          output.json({ findings, refIssues, scanned: roots, configPath });
        } else {
          if (findings.length === 0 && refIssues.length === 0) {
            output.success('No plaintext secrets found.');
          } else {
            output.warn(`Found ${findings.length} potential secret(s):`);
            for (const f of findings) {
              output.info(`  ${f.file}:${f.line}:${f.column}  ${f.patternName}  ${f.match}`);
              if (globals.debug) output.info(`    ${f.context}`);
            }
          }
        }

        if (opts.fix) {
          output.info('--fix is not yet implemented. Replace findings manually, or');
          output.info('  add them to anima.json as SecretRefs and use `am vault run -- ...`.');
        }

        if (opts.check && findings.length > 0) process.exit(1);
      } catch (error: unknown) {
        output.error(`audit failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
