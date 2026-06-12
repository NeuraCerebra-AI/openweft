import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { pathExists } from '../../src/fs/index.js';
import {
  createAgentProcessRegistry,
  getAgentProcessRegistryFile,
  readAgentProcessRegistry,
  resolveAgentKillTargets,
  type AgentProcessEntry
} from '../../src/orchestrator/agentProcessRegistry.js';

const entry = (overrides: Partial<AgentProcessEntry>): AgentProcessEntry => ({
  pid: 100,
  pgid: 100,
  command: 'codex',
  startedAt: '2026-06-11T10:00:00.000Z',
  ...overrides
});

describe('agent process registry', () => {
  it('derives the registry file from the .openweft directory', () => {
    expect(getAgentProcessRegistryFile({ openweftDir: '/repo/.openweft' })).toBe(
      path.join('/repo/.openweft', 'agent-pids.json')
    );
  });

  it('persists registered agent processes and removes the file when empty', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'openweft-agent-registry-'));
    const registryFile = path.join(dir, 'agent-pids.json');
    const registry = createAgentProcessRegistry({ registryFile });

    try {
      await registry.register(entry({ pid: 101, pgid: 101, command: 'codex' }));
      await registry.register(entry({ pid: 202, pgid: null, command: 'claude' }));

      expect(await readAgentProcessRegistry(registryFile)).toEqual([
        entry({ pid: 101, pgid: 101, command: 'codex' }),
        entry({ pid: 202, pgid: null, command: 'claude' })
      ]);

      await registry.unregister(101);
      expect(await readAgentProcessRegistry(registryFile)).toEqual([
        entry({ pid: 202, pgid: null, command: 'claude' })
      ]);

      await registry.unregister(202);
      expect(await pathExists(registryFile)).toBe(false);

      await registry.register(entry({ pid: 303 }));
      await registry.clear();
      expect(await pathExists(registryFile)).toBe(false);
    } finally {
      registry.dispose();
    }
  });

  it('returns an empty list for missing or corrupt registry files', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'openweft-agent-registry-corrupt-'));
    const registryFile = path.join(dir, 'agent-pids.json');

    expect(await readAgentProcessRegistry(registryFile)).toEqual([]);

    await writeFile(registryFile, 'not json at all', 'utf8');
    expect(await readAgentProcessRegistry(registryFile)).toEqual([]);

    await writeFile(registryFile, JSON.stringify({ entries: [{ pid: 'nope' }, null, { pid: 55 }] }), 'utf8');
    expect(await readAgentProcessRegistry(registryFile)).toEqual([
      { pid: 55, pgid: null, command: '', startedAt: '' }
    ]);
  });

  it('targets process groups on POSIX and falls back to plain pids on win32', () => {
    const entries = [
      entry({ pid: 11, pgid: 11 }),
      entry({ pid: 22, pgid: null, command: 'claude' })
    ];

    expect(resolveAgentKillTargets(entries, 'darwin')).toEqual([-11, 22]);
    expect(resolveAgentKillTargets(entries, 'linux')).toEqual([-11, 22]);
    expect(resolveAgentKillTargets(entries, 'win32')).toEqual([11, 22]);
  });

  it('deduplicates kill targets that share a process group', () => {
    const entries = [
      entry({ pid: 11, pgid: 11 }),
      entry({ pid: 12, pgid: 11 })
    ];

    expect(resolveAgentKillTargets(entries, 'linux')).toEqual([-11]);
  });
});
