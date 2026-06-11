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

    expect(workflow).toMatch(/npm@11\.6\.0/);
    expect(workflow).toMatch(/npm --version/);
    expect(workflow).toMatch(/run: npm run release:check/);
  });

  it('documents live provider readiness as a separate release SOP', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('npm run release:check');
    expect(readme).toContain('package/repo readiness');
    expect(readme).toContain('OPENWEFT_LIVE_SMOKE_TIMEOUT_MS=<timeout> npm run smoke:live:codex:resume');
    expect(readme).toContain('npm run smoke:live:claude');
    expect(readme).toContain('same release window');
  });

  it('packaged CLI smoke runs init, add, and start --dry-run from an installed tarball', async () => {
    const script = await readFile(path.join(repoRoot, 'scripts', 'packaged-cli-smoke.mjs'), 'utf8');

    expect(script).toContain("'init'");
    expect(script).toContain("'add'");
    expect(script).toContain("'start'");
    expect(script).toContain("'--dry-run'");
  });

  it('packaged CLI smoke removes the packed tarball even when later smoke steps fail', async () => {
    const script = await readFile(path.join(repoRoot, 'scripts', 'packaged-cli-smoke.mjs'), 'utf8');

    expect(script).toMatch(/let tarballPath\b/);
    expect(script).toMatch(/finally\s*{[\s\S]*await rm\(tarballPath, \{ force: true \}\)/);
  });
});
