import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

describe('release launch readiness', () => {
  it('uses absolute README asset URLs for published renderers', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain(
      'srcset="https://raw.githubusercontent.com/NeuraCerebra-AI/openweft/main/docs/banner-dark.svg"'
    );
    expect(readme).toContain(
      'srcset="https://raw.githubusercontent.com/NeuraCerebra-AI/openweft/main/docs/banner-light.svg"'
    );
    expect(readme).toContain(
      'src="https://raw.githubusercontent.com/NeuraCerebra-AI/openweft/main/docs/banner-dark.svg"'
    );
    expect(readme).toContain(
      'srcset="https://raw.githubusercontent.com/NeuraCerebra-AI/openweft/main/docs/hero-dark.svg"'
    );
    expect(readme).toContain(
      'srcset="https://raw.githubusercontent.com/NeuraCerebra-AI/openweft/main/docs/hero-light.svg"'
    );
    expect(readme).toContain(
      'src="https://raw.githubusercontent.com/NeuraCerebra-AI/openweft/main/docs/hero-dark.svg"'
    );
  });

  it('runs the documented release gate in CI', async () => {
    const workflow = await readFile(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

    expect(workflow).toMatch(/run: npm run release:check/);
  });
});
