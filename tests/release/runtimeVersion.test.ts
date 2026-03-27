import { describe, expect, it } from 'vitest';

import packageJson from '../../package.json' with { type: 'json' };
import { buildProgram } from '../../src/cli/buildProgram.js';
import { OPENWEFT_VERSION } from '../../src/version.js';

describe('runtime version wiring', () => {
  it('keeps the shared runtime version aligned with package.json', () => {
    expect(OPENWEFT_VERSION).toBe(packageJson.version);
  });

  it('uses the shared runtime version for the CLI program', () => {
    const program = buildProgram();

    expect((program as { _version?: string })._version).toBe(OPENWEFT_VERSION);
  });
});
