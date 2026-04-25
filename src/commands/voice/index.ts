import { Command } from 'commander';
import { voiceCatalogCommand } from './catalog.js';
import { listCallsCommand } from './calls.js';
import { getCallCommand } from './get.js';
import { placeCallCommand } from './place.js';
import { transcriptCommand } from './transcript.js';
import { summaryCommand } from './summary.js';
import { scoreCommand } from './score.js';
import { searchCommand } from './search.js';

export function voiceCommands(): Command {
  const cmd = new Command('voice')
    .description('Voice — place calls, list, transcripts, summaries, scores, and search');

  cmd.addCommand(voiceCatalogCommand());
  cmd.addCommand(placeCallCommand());
  cmd.addCommand(listCallsCommand());
  cmd.addCommand(getCallCommand());
  cmd.addCommand(transcriptCommand());
  cmd.addCommand(summaryCommand());
  cmd.addCommand(scoreCommand());
  cmd.addCommand(searchCommand());

  return cmd;
}
