import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createConfigHash, getDefaultConfig, loadOpenWeftConfig } from '../../src/config/index.js';

describe('loadOpenWeftConfig', () => {
  it('returns the documented defaults when no config file exists', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-config-defaults-'));

    const { config, configHash } = await loadOpenWeftConfig(tempDirectory);

    expect(config.backend).toBe('codex');
    expect(config.paths.openweftDir).toBe(path.join(tempDirectory, '.openweft'));
    expect(config.paths.queueFile).toBe(path.join(tempDirectory, 'feature_requests', 'queue.txt'));
    expect(configHash).toBe(createConfigHash(config));
  });

  it('loads .openweftrc.json and resolves relative paths from the config location', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-config-file-'));
    const nestedDirectory = path.join(tempDirectory, 'workspace');
    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(
      path.join(tempDirectory, '.openweftrc.json'),
      JSON.stringify({
        ...getDefaultConfig(),
        prompts: {
          promptA: './prompts/a.md',
          planAdjustment: './prompts/b.md'
        },
        featureRequestsDir: './requests',
        queueFile: './requests/custom-queue.txt'
      }),
      'utf8'
    );

    const { config } = await loadOpenWeftConfig(nestedDirectory);

    expect(config.configFilePath).toBe(path.join(tempDirectory, '.openweftrc.json'));
    expect(config.repoRoot).toBe(tempDirectory);
    expect(config.paths.promptA).toBe(path.join(tempDirectory, 'prompts', 'a.md'));
    expect(config.paths.planAdjustment).toBe(path.join(tempDirectory, 'prompts', 'b.md'));
    expect(config.paths.featureRequestsDir).toBe(path.join(tempDirectory, 'requests'));
    expect(config.paths.queueFile).toBe(path.join(tempDirectory, 'requests', 'custom-queue.txt'));
  });

  it('keeps the config hash stable across different invocation directories in the same project', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-config-hash-'));
    const nestedDirectory = path.join(tempDirectory, 'workspace', 'deeper');
    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(
      path.join(tempDirectory, '.openweftrc.json'),
      JSON.stringify(getDefaultConfig()),
      'utf8'
    );

    const fromRoot = await loadOpenWeftConfig(tempDirectory);
    const fromNested = await loadOpenWeftConfig(nestedDirectory);

    expect(fromNested.config.repoRoot).toBe(tempDirectory);
    expect(fromNested.configHash).toBe(fromRoot.configHash);
  });
});
