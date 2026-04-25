import { describe, expect, it } from 'vitest';

import { buildProgram } from '../../src/cli/buildProgram.js';

describe('buildProgram', () => {
  it('registers the expected top-level commands', () => {
    const program = buildProgram();
    const commandNames = program.commands.map((command) => command.name());

    expect(commandNames).toEqual(['init', 'add', 'start', 'status', 'stop']);
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
});
