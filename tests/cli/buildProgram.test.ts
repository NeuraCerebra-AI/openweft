import { describe, expect, it } from 'vitest';

import { buildProgram } from '../../src/cli/buildProgram.js';

describe('buildProgram', () => {
  it('registers the expected top-level commands', () => {
    const program = buildProgram();
    const commandNames = program.commands.map((command) => command.name());

    expect(commandNames).toEqual(['init', 'add', 'start', 'resume', 'status', 'stop']);
  });

  it('registers start execution mode flags', () => {
    const program = buildProgram();
    const startCommand = program.commands.find((command) => command.name() === 'start');

    expect(startCommand).toBeDefined();
    expect(startCommand?.options.map((option) => option.long)).toEqual([
      '--bg',
      '--stream',
      '--tmux',
      '--dry-run',
      '--model',
      '--effort'
    ]);
  });

  it('registers resume as the same checkpoint path as start', async () => {
    const calls: string[] = [];
    const program = buildProgram({
      start: () => {
        calls.push('start');
      }
    });

    await program.parseAsync(['node', 'openweft', 'resume']);

    const resumeCommand = program.commands.find((command) => command.name() === 'resume');
    expect(calls).toEqual(['start']);
    expect(resumeCommand?.description()).toMatch(/Resume.*same checkpoint path as start/i);
  });
});
