import { copyFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { pathExists, writeTextFileAtomic } from '../fs/index.js';
import type { AdapterAuthConfig, AdapterSandboxMode } from './types.js';

const tomlString = (value: string): string => JSON.stringify(value);

export const buildMinimalCodexWorkerConfig = (input: {
  cwd: string;
  sandboxMode?: AdapterSandboxMode;
}): string => {
  const sandboxMode = input.sandboxMode ?? 'danger-full-access';

  return [
    'approval_policy = "never"',
    `sandbox_mode = ${tomlString(sandboxMode)}`,
    '',
    `[projects.${tomlString(input.cwd)}]`,
    'trust_level = "trusted"',
    ''
  ].join('\n');
};

export const prepareCodexWorkerHome = async (input: {
  homeDir: string;
  cwd: string;
  sandboxMode?: AdapterSandboxMode;
  auth: AdapterAuthConfig;
  defaultCodexHome?: string;
}): Promise<void> => {
  await mkdir(input.homeDir, { recursive: true });

  const defaultCodexHome = input.defaultCodexHome ?? path.join(os.homedir(), '.codex');

  if (input.auth.method === 'subscription') {
    const authFile = path.join(defaultCodexHome, 'auth.json');
    if (await pathExists(authFile)) {
      await copyFile(authFile, path.join(input.homeDir, 'auth.json'));
    }
  }

  await writeTextFileAtomic(
    path.join(input.homeDir, 'config.toml'),
    buildMinimalCodexWorkerConfig({
      cwd: input.cwd,
      ...(input.sandboxMode !== undefined ? { sandboxMode: input.sandboxMode } : {})
    })
  );
};
