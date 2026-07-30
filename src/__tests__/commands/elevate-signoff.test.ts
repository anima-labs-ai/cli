/**
 * `am auth elevate` signs off by telling you how to get back. That sentence is
 * advertised syntax, and it shipped fiction: with no previous profile it said
 * `am config profile use default`, which can only ever answer
 * `Profile "default" does not exist`. There is no profile named `default` —
 * "normal" is `activeProfile` being unset.
 *
 * Checked with the same validator the `demo` and `onboard` guards use, so this
 * surface is now held to the rule those two already were: do not print a
 * command the CLI cannot run.
 */
import { describe, expect, test } from 'bun:test';
import { backToNormal } from '../../commands/auth/elevate.js';
import { createProgram } from '../../cli.js';
import { validateAdvertisedCommand } from '../helpers/advertised-commands.js';

/** Pull the command out of `Switched to profile "x". Back to normal:  <cmd>`. */
function advertisedCommand(sentence: string): string {
  const after = sentence.split('Back to normal:')[1];
  expect(after).toBeDefined();
  return (after as string).trim();
}

describe('elevate sign-off advertises a real command', () => {
  const program = createProgram();

  test('with a previous profile, it points back at that profile', () => {
    const cmd = advertisedCommand(backToNormal('org-elevated', 'work'));
    expect(cmd).toBe('am config profile use work');
    expect(validateAdvertisedCommand(program, cmd)).toEqual([]);
  });

  test('with no previous profile, it points at a command that exists', () => {
    const cmd = advertisedCommand(backToNormal('org-elevated', undefined));
    // The regression: `am config profile use default` parses as valid syntax,
    // so the validator alone would not have caught it. Naming the command is
    // what pins the behaviour — `clear` needs no profile to exist.
    expect(cmd).toBe('am config profile clear');
    expect(validateAdvertisedCommand(program, cmd)).toEqual([]);
  });

  test('`config profile clear` is a real subcommand', () => {
    const profile = program.commands
      .find((c) => c.name() === 'config')
      ?.commands.find((c) => c.name() === 'profile');
    expect(profile?.commands.map((c) => c.name()).sort()).toContain('clear');
  });
});
