#!/usr/bin/env node

import { buildProgram } from '../index.js';
import { createCommandHandlers } from '../cli/handlers.js';

const handlers = createCommandHandlers();

if (process.argv.length <= 2) {
  await handlers.launch();
} else {
  await buildProgram(handlers).parseAsync(process.argv);
}
