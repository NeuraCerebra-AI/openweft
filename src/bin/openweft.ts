#!/usr/bin/env node

import { buildProgram } from '../index.js';
import { createCommandHandlers } from '../cli/handlers.js';

const handlers = createCommandHandlers();

try {
  if (process.argv.length <= 2) {
    await handlers.launch();
  } else {
    await buildProgram(handlers).parseAsync(process.argv);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
