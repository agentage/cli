import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerSetup } from './setup.js';

describe('registerSetup', () => {
  const setupCommand = (): Command => {
    const program = new Command();
    registerSetup(program, async () => undefined);
    return program.commands[0] ?? new Command();
  };

  it('keeps the sign-in flags first, then the extension options, with no switch to turn them on', () => {
    expect(setupCommand().options.map((o) => o.long)).toEqual([
      '--disconnect',
      '--reauth',
      '--no-browser',
      '--profile',
      '--dry-run',
      '--check',
      '--latest',
      '--json',
    ]);
  });

  it('says in its help what --latest does and that extensions are part of setup', () => {
    let help = '';
    const command = setupCommand().configureOutput({ writeOut: (text) => void (help += text) });
    command.outputHelp();
    expect(help).toContain('--latest');
    expect(help).toContain('npm update');
    expect(help).not.toContain('AGENTAGE_EXTENSIONS=');
  });
});
