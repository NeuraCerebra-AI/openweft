import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { prepareCodexWorkerHome } from '../../src/adapters/codexHome.js';

describe('codex worker home preparation', () => {
  it('copies subscription auth but writes a minimal worker config', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-codex-home-'));
    const defaultCodexHome = path.join(tempRoot, 'default-codex-home');
    const workerHome = path.join(tempRoot, 'worker-home');
    const workerCwd = path.join(tempRoot, 'repo', '.openweft', 'worktrees', '001');

    await mkdir(defaultCodexHome, { recursive: true });
    await writeFile(path.join(defaultCodexHome, 'auth.json'), '{"token":"fake"}\n', 'utf8');
    await writeFile(
      path.join(defaultCodexHome, 'config.toml'),
      [
        'notify = ["say", "done"]',
        '[projects."/Users/example/unrelated"]',
        'trust_level = "trusted"',
        '[mcp_servers.context7]',
        'command = "context7"',
        '[plugins.superpowers]',
        'enabled = true'
      ].join('\n'),
      'utf8'
    );

    await prepareCodexWorkerHome({
      homeDir: workerHome,
      cwd: workerCwd,
      sandboxMode: 'read-only',
      auth: { method: 'subscription' },
      defaultCodexHome
    });

    await expect(readFile(path.join(workerHome, 'auth.json'), 'utf8')).resolves.toBe(
      '{"token":"fake"}\n'
    );

    const workerConfig = await readFile(path.join(workerHome, 'config.toml'), 'utf8');
    expect(workerConfig).toContain('approval_policy = "never"');
    expect(workerConfig).toContain('sandbox_mode = "read-only"');
    expect(workerConfig).toContain(`[projects.${JSON.stringify(workerCwd)}]`);
    expect(workerConfig).toContain('trust_level = "trusted"');
    expect(workerConfig).not.toContain('notify');
    expect(workerConfig).not.toContain('mcp_servers');
    expect(workerConfig).not.toContain('plugins');
    expect(workerConfig).not.toContain('/Users/example/unrelated');
    expect(workerConfig).not.toContain('superpowers');
  });

  it('overwrites the sandbox mode when the same worker home is reused for a later turn', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-codex-home-reuse-'));
    const defaultCodexHome = path.join(tempRoot, 'default-codex-home');
    const workerHome = path.join(tempRoot, 'worker-home');
    const workerCwd = path.join(tempRoot, 'repo');

    await mkdir(defaultCodexHome, { recursive: true });

    await prepareCodexWorkerHome({
      homeDir: workerHome,
      cwd: workerCwd,
      sandboxMode: 'read-only',
      auth: { method: 'api_key', envVar: 'CODEX_API_KEY' },
      defaultCodexHome
    });
    await prepareCodexWorkerHome({
      homeDir: workerHome,
      cwd: workerCwd,
      sandboxMode: 'danger-full-access',
      auth: { method: 'api_key', envVar: 'CODEX_API_KEY' },
      defaultCodexHome
    });

    const workerConfig = await readFile(path.join(workerHome, 'config.toml'), 'utf8');
    expect(workerConfig).toContain('sandbox_mode = "danger-full-access"');
    expect(workerConfig).not.toContain('sandbox_mode = "read-only"');

    await expect(readFile(path.join(workerHome, 'auth.json'), 'utf8')).rejects.toThrow();
  });
});
