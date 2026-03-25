import { Command } from 'commander';
import type { GlobalOptions } from '../../lib/auth.js';
import { getAuthConfig, getConfig, saveAuthConfig, saveConfig } from '../../lib/config.js';
import { Output } from '../../lib/output.js';

const DEFAULT_API_URL = 'https://api.anima.com';
const DEFAULT_OUTPUT_FORMAT = 'table';

type OutputFormat = 'table' | 'json' | 'yaml';

interface InitOptions {
  nonInteractive?: boolean;
  apiKey?: string;
  apiUrl?: string;
  org?: string;
  identity?: string;
  format?: string;
}

interface InitResult {
  apiUrl: string;
  apiKeyConfigured: boolean;
  defaultOrg?: string;
  defaultIdentity?: string;
  outputFormat: OutputFormat;
  mcpSuggested: boolean;
}

function normalizeOutputFormat(format?: string): OutputFormat | null {
  const normalized = format?.trim().toLowerCase() ?? DEFAULT_OUTPUT_FORMAT;
  if (normalized === 'table') return 'table';
  if (normalized === 'json') return 'json';
  if (normalized === 'yaml') return 'yaml';
  return null;
}

function isValidApiKey(apiKey: string): boolean {
  return apiKey.startsWith('ak_');
}

export function initCommand(): Command {
  return new Command('init')
    .description('Set up Anima CLI with guided wizard')
    .option('--non-interactive', 'Use defaults without prompting')
    .option('--api-key <key>', 'API key (required in non-interactive mode)')
    .option('--api-url <url>', 'API URL')
    .option('--org <org>', 'Default organization')
    .option('--identity <id>', 'Default identity')
    .option('--format <format>', 'Output format (table/json/yaml)')
    .action(async function (this: Command) {
      const opts = this.opts<InitOptions>();
      const globals = this.optsWithGlobals<InitOptions & GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      let apiUrl = DEFAULT_API_URL;
      let apiKey = '';
      let org: string | undefined;
      let identity: string | undefined;
      let format: OutputFormat = DEFAULT_OUTPUT_FORMAT;
      let mcpSuggested = false;

      if (opts.nonInteractive) {
        const nonInteractiveApiKey = opts.apiKey?.trim() ?? '';
        if (!nonInteractiveApiKey) {
          output.error('Missing required flag --api-key in non-interactive mode.');
          return;
        }

        if (!isValidApiKey(nonInteractiveApiKey)) {
          output.error('Invalid API key. API key must start with "ak_".');
          return;
        }

        apiKey = nonInteractiveApiKey;
        apiUrl = opts.apiUrl?.trim() || DEFAULT_API_URL;
        org = opts.org?.trim() || undefined;
        identity = opts.identity?.trim() || undefined;

        const parsedFormat = normalizeOutputFormat(opts.format);
        if (!parsedFormat) {
          output.error('Invalid format. Supported values: table, json, yaml.');
          return;
        }
        format = parsedFormat;
      } else {
        output.info("Welcome to Anima! Let's set up your CLI.");

        apiUrl = prompt(`API URL [${DEFAULT_API_URL}]: `)?.trim() || DEFAULT_API_URL;
        apiKey = prompt('API Key (ak_...): ')?.trim() ?? '';

        if (!isValidApiKey(apiKey)) {
          output.error('Invalid API key. API key must start with "ak_".');
          return;
        }

        org = prompt('Default organization (optional): ')?.trim() || undefined;
        identity = prompt('Default identity (optional): ')?.trim() || undefined;

        const formatInput = prompt(`Output format (table/json/yaml) [${DEFAULT_OUTPUT_FORMAT}]: `)?.trim() || DEFAULT_OUTPUT_FORMAT;
        const parsedFormat = normalizeOutputFormat(formatInput);
        if (!parsedFormat) {
          output.error('Invalid format. Supported values: table, json, yaml.');
          return;
        }
        format = parsedFormat;

        const mcpAnswer = prompt('Would you like to set up MCP for your IDE? (y/N)')?.trim().toLowerCase() ?? '';
        mcpSuggested = mcpAnswer === 'y' || mcpAnswer === 'yes';
      }

      await saveAuthConfig({
        ...(await getAuthConfig()),
        apiKey,
        apiUrl,
      });

      await saveConfig({
        ...(await getConfig()),
        defaultOrg: org,
        defaultIdentity: identity,
        outputFormat: format,
      });

      const result: InitResult = {
        apiUrl,
        apiKeyConfigured: true,
        defaultOrg: org,
        defaultIdentity: identity,
        outputFormat: format,
        mcpSuggested,
      };

      if (globals.json) {
        output.json(result);
        return;
      }

      output.success('Anima CLI setup complete.');
      output.details([
        ['API URL', apiUrl],
        ['API Key', 'Configured'],
        ['Default Organization', org],
        ['Default Identity', identity],
        ['Output Format', format],
      ]);

      if (mcpSuggested) {
        output.info('To set up MCP for your IDE, run: am setup-mcp install');
      }
    });
}
