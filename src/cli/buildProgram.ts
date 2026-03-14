import { Command } from 'commander';

export type CommandHandler = (...args: unknown[]) => Promise<void> | void;

export interface CommandHandlers {
  launch: CommandHandler;
  init: CommandHandler;
  add: CommandHandler;
  start: CommandHandler;
  status: CommandHandler;
  stop: CommandHandler;
}

const createPlaceholderHandler = (commandName: string): CommandHandler => {
  return () => {
    throw new Error(`Command "${commandName}" is not wired yet.`);
  };
};

export const createDefaultHandlers = (): CommandHandlers => ({
  launch: createPlaceholderHandler('launch'),
  init: createPlaceholderHandler('init'),
  add: createPlaceholderHandler('add'),
  start: createPlaceholderHandler('start'),
  status: createPlaceholderHandler('status'),
  stop: createPlaceholderHandler('stop')
});

export const buildProgram = (handlers: Partial<CommandHandlers> = {}): Command => {
  const resolvedHandlers: CommandHandlers = {
    ...createDefaultHandlers(),
    ...handlers
  };

  const program = new Command();

  program
    .name('openweft')
    .description('Orchestrate phased AI coding work across Codex CLI and Claude Code.')
    .version('0.1.0');

  // Default action: runs when no subcommand is given.
  program.action(async (...args) => {
    await resolvedHandlers.launch(...args);
  });

  program
    .command('init')
    .description('Initialize OpenWeft in the current repository.')
    .action(async (...args) => {
      await resolvedHandlers.init(...args);
    });

  program
    .command('add [request]')
    .description('Add a feature request to the queue.')
    .action(async (...args) => {
      await resolvedHandlers.add(...args);
    });

  program
    .command('start')
    .description('Start the orchestration run.')
    .option('--bg', 'Run in the background.')
    .option('--stream', 'Stream raw agent output.')
    .option('--tmux', 'Use tmux session output for agents when available.')
    .option('--dry-run', 'Use the mock adapter and avoid real backend execution.')
    .action(async (...args) => {
      await resolvedHandlers.start(...args);
    });

  program
    .command('status')
    .description('Show the current OpenWeft run status.')
    .action(async (...args) => {
      await resolvedHandlers.status(...args);
    });

  program
    .command('stop')
    .description('Request a graceful stop for the current OpenWeft run.')
    .action(async (...args) => {
      await resolvedHandlers.stop(...args);
    });

  return program;
};
