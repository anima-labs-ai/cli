import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface VoiceCatalogOptions {
  tier?: 'basic' | 'premium';
  gender?: 'male' | 'female' | 'neutral';
  language?: string;
}

export function voiceCatalogCommand(): Command {
  return new Command('voices')
    .description('List available voices for AI agent phone calls')
    .option('--tier <tier>', 'Filter by tier (basic or premium)')
    .option('--gender <gender>', 'Filter by gender (male, female, neutral)')
    .option('--language <lang>', 'Filter by language code (e.g. en, en-US, fr-FR)')
    .action(async function (this: Command) {
      const opts = this.opts<VoiceCatalogOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);

        const input: {
          tier?: 'basic' | 'premium';
          gender?: 'male' | 'female' | 'neutral';
          language?: string;
        } = {};
        if (opts.tier) input.tier = opts.tier;
        if (opts.gender) input.gender = opts.gender;
        if (opts.language) input.language = opts.language;

        const response = await orpc.voice.catalog(input);

        if (globals.json) {
          output.json(response);
          return;
        }

        if (!response.voices || response.voices.length === 0) {
          output.info('No voices found matching filters');
          return;
        }

        output.table(
          ['ID', 'Name', 'Provider', 'Tier', 'Gender', 'Language', 'Style', 'Description'],
          response.voices.map((v) => [
            v.id,
            v.name,
            v.provider,
            v.tier,
            v.gender ?? '-',
            v.language,
            v.style ?? '-',
            v.description ? (v.description.length > 40 ? `${v.description.slice(0, 40)}...` : v.description) : '-',
          ]),
        );

        output.info(`\n${response.voices.length} voice(s) found`);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to list voices: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
