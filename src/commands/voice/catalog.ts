import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface VoiceCatalogOptions {
  tier?: string;
  gender?: string;
  language?: string;
}

interface CatalogVoice {
  id: string;
  name: string;
  provider: string;
  tier: string;
  gender?: string;
  language: string;
  accent?: string;
  style?: string;
  ageRange?: string;
  description?: string;
}

interface CatalogResponse {
  voices: CatalogVoice[];
}

export function voiceCatalogCommand(): Command {
  return new Command('catalog')
    .description('List available voices for AI agent calls')
    .option('--tier <tier>', 'Filter by tier (basic or premium)')
    .option('--gender <gender>', 'Filter by gender (male, female, neutral)')
    .option('--language <lang>', 'Filter by language code (e.g. en, en-US, fr-FR)')
    .action(async function (this: Command) {
      const opts = this.opts<VoiceCatalogOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);

        const params: Record<string, string> = {};
        if (opts.tier) params.tier = opts.tier;
        if (opts.gender) params.gender = opts.gender;
        if (opts.language) params.language = opts.language;

        const response = await client.get<CatalogResponse>('/voice/catalog', params);

        if (globals.json) {
          output.json(response);
          return;
        }

        if (!response.voices || response.voices.length === 0) {
          output.info('No voices found matching filters');
          return;
        }

        output.table(
          ['ID', 'Name', 'Provider', 'Tier', 'Gender', 'Language', 'Style'],
          response.voices.map((v) => [
            v.id,
            v.name,
            v.provider,
            v.tier,
            v.gender ?? '-',
            v.language,
            v.style ?? '-',
          ]),
        );

        output.info(`\n${response.voices.length} voice(s) found`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list voices: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
