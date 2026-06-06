#!/usr/bin/env node

import { buildProgram } from '../index.js';
import { createCommandHandlers } from '../cli/handlers.js';

/**
 * Print an expected (handler) error as a clean, human-readable message instead
 * of a raw V8 stack trace, and mark the process as failed. We intentionally do
 * NOT print err.stack: handlers throw plain Errors for expected conditions
 * (e.g. "OpenWeft is not initialized here…"), and a stack trace + code frame is
 * noise for the user. When a cause is attached we surface its message too.
 */
const reportFatalError = (error: unknown): void => {
  if (error instanceof Error) {
    process.stderr.write(`${error.message}\n`);
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      process.stderr.write(`Caused by: ${cause.message}\n`);
    } else if (typeof cause === 'string' && cause) {
      process.stderr.write(`Caused by: ${cause}\n`);
    }
  } else {
    process.stderr.write(`${String(error)}\n`);
  }
  process.exitCode = 1;
};

// Guard against rejections/exceptions that escape the awaited entrypoint so the
// user always gets a clean message and a non-zero exit instead of a stack dump.
process.on('unhandledRejection', (reason) => {
  reportFatalError(reason);
  process.exit(1);
});
process.on('uncaughtException', (error) => {
  reportFatalError(error);
  process.exit(1);
});

const handlers = createCommandHandlers();

try {
  if (process.argv.length <= 2) {
    await handlers.launch();
  } else {
    await buildProgram(handlers).parseAsync(process.argv);
  }
} catch (error) {
  reportFatalError(error);
}
