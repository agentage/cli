import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

import { registerCompletions } from './completions.js';

describe('completions command', () => {
  let program: Command;
  let logs: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    program = new Command();
    program.exitOverride();
    registerCompletions(program);
  });

  it('generates bash completions with _agentage function', async () => {
    await program.parseAsync(['node', 'agentage', 'completions', 'bash']);

    const output = logs.join('\n');
    expect(output).toContain('_agentage()');
    expect(output).toContain('complete -F _agentage agentage');
    expect(output).toContain('COMPREPLY');
  });

  it('generates zsh completions with compdef', async () => {
    await program.parseAsync(['node', 'agentage', 'completions', 'zsh']);

    const output = logs.join('\n');
    expect(output).toContain('#compdef agentage');
    expect(output).toContain('_agentage');
  });

  it('generates fish completions with complete -c', async () => {
    await program.parseAsync(['node', 'agentage', 'completions', 'fish']);

    const output = logs.join('\n');
    expect(output).toContain('complete -c agentage');
    expect(output).toContain('run');
    expect(output).toContain('agents');
    expect(output).toContain('status');
  });

  it('bash completions include all commands', async () => {
    await program.parseAsync(['node', 'agentage', 'completions', 'bash']);

    const output = logs.join('\n');
    for (const cmd of ['run', 'agents', 'runs', 'machines', 'status', 'login', 'whoami']) {
      expect(output).toContain(cmd);
    }
  });
});
