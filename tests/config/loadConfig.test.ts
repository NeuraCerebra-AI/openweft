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
    expect(config.effort).toEqual({
      codex: 'medium',
      claude: 'medium'
    });
    expect(config.approval).toBe('always');
    expect(config.status).toEqual({
      usageDisplay: 'tokens'
    });
    expect(config.runtime).toEqual({
      codexHomeRetention: 'on-success-clean'
    });
    expect(config.paths.openweftDir).toBe(path.join(tempDirectory, '.openweft'));
    expect(config.paths.codexHomeDir).toBe(path.join(tempDirectory, '.openweft', 'codex-home'));
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

  it('deep-merges backend-specific effort overrides and top-level approval overrides', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-config-effort-merge-'));
    await writeFile(
      path.join(tempDirectory, '.openweftrc.json'),
      JSON.stringify({
        approval: 'per-feature',
        effort: {
          codex: 'high'
        }
      }),
      'utf8'
    );

    const { config } = await loadOpenWeftConfig(tempDirectory);

    expect(config.approval).toBe('per-feature');
    expect(config.effort).toEqual({
      codex: 'high',
      claude: 'medium'
    });
  });

  it('loads an explicit status usage display override', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-config-status-display-'));
    await writeFile(
      path.join(tempDirectory, '.openweftrc.json'),
      JSON.stringify({
        status: {
          usageDisplay: 'estimated-cost'
        }
      }),
      'utf8'
    );

    const { config } = await loadOpenWeftConfig(tempDirectory);

    expect(config.status).toEqual({
      usageDisplay: 'estimated-cost'
    });
  });

  it('loads an explicit runtime codex-home retention override', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-config-runtime-'));
    await writeFile(
      path.join(tempDirectory, '.openweftrc.json'),
      JSON.stringify({
        runtime: {
          codexHomeRetention: 'preserve'
        }
      }),
      'utf8'
    );

    const { config } = await loadOpenWeftConfig(tempDirectory);

    expect(config.runtime).toEqual({
      codexHomeRetention: 'preserve'
    });
  });

  it('changes the config hash when effort, approval, status usage display, or runtime policy changes', async () => {
    const defaults = getDefaultConfig();

    const approvalHash = createConfigHash({
      ...defaults,
      approval: 'first-only'
    });
    const effortHash = createConfigHash({
      ...defaults,
      effort: {
        ...defaults.effort,
        codex: 'high'
      }
    });
    const statusHash = createConfigHash({
      ...defaults,
      status: {
        usageDisplay: 'estimated-cost'
      }
    });
    const runtimeHash = createConfigHash({
      ...defaults,
      runtime: {
        codexHomeRetention: 'preserve'
      }
    });

    expect(approvalHash).not.toBe(createConfigHash(defaults));
    expect(effortHash).not.toBe(createConfigHash(defaults));
    expect(statusHash).not.toBe(createConfigHash(defaults));
    expect(runtimeHash).not.toBe(createConfigHash(defaults));
  });

  it('formats invalid config schema errors with the config file path', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-config-invalid-'));
    const configPath = path.join(tempDirectory, '.openweftrc.json');
    await writeFile(
      configPath,
      JSON.stringify({
        ...getDefaultConfig(),
        backend: 'openai'
      }),
      'utf8'
    );

    await expect(loadOpenWeftConfig(tempDirectory)).rejects.toThrow(
      new RegExp(`Error in ${configPath.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`)
    );
    await expect(loadOpenWeftConfig(tempDirectory)).rejects.toThrow(/backend/);
  });

  it('rejects the internal mock backend in user config files', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-config-mock-backend-'));
    await writeFile(
      path.join(tempDirectory, '.openweftrc.json'),
      JSON.stringify({
        ...getDefaultConfig(),
        backend: 'mock'
      }),
      'utf8'
    );

    await expect(loadOpenWeftConfig(tempDirectory)).rejects.toThrow(/backend/);
  });

  it('rejects invalid approval values', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-config-invalid-approval-'));
    await writeFile(
      path.join(tempDirectory, '.openweftrc.json'),
      JSON.stringify({
        ...getDefaultConfig(),
        approval: 'per-turn'
      }),
      'utf8'
    );

    await expect(loadOpenWeftConfig(tempDirectory)).rejects.toThrow(/approval/);
  });

  it('rejects invalid backend effort values', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-config-invalid-effort-'));
    await writeFile(
      path.join(tempDirectory, '.openweftrc.json'),
      JSON.stringify({
        ...getDefaultConfig(),
        effort: {
          codex: 'max',
          claude: 'medium'
        }
      }),
      'utf8'
    );

    await expect(loadOpenWeftConfig(tempDirectory)).rejects.toThrow(/effort\.codex/);
  });

  it('rejects unsupported audio config fields', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-config-audio-'));
    await writeFile(
      path.join(tempDirectory, '.openweftrc.json'),
      JSON.stringify({
        ...getDefaultConfig(),
        audio: {
          enabled: true,
          station: 'groovesalad'
        }
      }),
      'utf8'
    );

    await expect(loadOpenWeftConfig(tempDirectory)).rejects.toThrow(/audio/);
  });

  it('rejects invalid status usage display values', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-config-invalid-status-display-'));
    await writeFile(
      path.join(tempDirectory, '.openweftrc.json'),
      JSON.stringify({
        ...getDefaultConfig(),
        status: {
          usageDisplay: 'money'
        }
      }),
      'utf8'
    );

    await expect(loadOpenWeftConfig(tempDirectory)).rejects.toThrow(/status\.usageDisplay/);
  });

  it('rejects invalid runtime codex-home retention values', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-config-invalid-runtime-'));
    await writeFile(
      path.join(tempDirectory, '.openweftrc.json'),
      JSON.stringify({
        ...getDefaultConfig(),
        runtime: {
          codexHomeRetention: 'delete-it'
        }
      }),
      'utf8'
    );

    await expect(loadOpenWeftConfig(tempDirectory)).rejects.toThrow(/runtime\.codexHomeRetention/);
  });
});
