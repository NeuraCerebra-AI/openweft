#!/usr/bin/env node

import { buildProgram } from '../index.js';
import { createCommandHandlers } from '../cli/handlers.js';

await buildProgram(createCommandHandlers()).parseAsync(process.argv);
