import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

describe('release launch readiness', () => {
  it('uses repo-relative README asset URLs for GitHub rendering', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('src="./docs/banner-dark.svg"');
    expect(readme).toContain('src="./docs/hero-dark.svg"');
    expect(readme).toContain('src="./docs/wizard-dark.svg"');
    expect(readme).not.toContain('srcset="./docs/wizard-dark.svg"');
    expect(readme).not.toContain('srcset="./docs/wizard-light.svg"');
  });

  it('runs the documented release gate in CI', async () => {
    const workflow = await readFile(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

    expect(workflow).toMatch(/run: npm run release:check/);
  });
});
