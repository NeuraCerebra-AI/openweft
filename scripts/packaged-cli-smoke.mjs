import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';

const repoRoot = path.resolve(import.meta.dirname, '..');

const run = async () => {
  const workingRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-pack-smoke-'));
  const installRoot = path.join(workingRoot, 'install');
  let tarballPath = null;

  try {
    const packResult = await execa('npm', ['pack', '--json'], {
      cwd: repoRoot
    });
    const parsed = JSON.parse(packResult.stdout);
    const tarballName = parsed[0]?.filename;

    if (!tarballName) {
      throw new Error('npm pack did not return a tarball filename.');
    }

    tarballPath = path.join(repoRoot, tarballName);

    await execa('npm', ['init', '-y'], {
      cwd: workingRoot
    });
    await writeFile(
      path.join(workingRoot, 'package.json'),
      `${JSON.stringify({ name: 'openweft-packaged-cli-smoke', private: true }, null, 2)}\n`,
      'utf8'
    );
    await execa('npm', ['install', tarballPath], {
      cwd: workingRoot
    });

    const installedCli = path.join(
      workingRoot,
      'node_modules',
      'openweft',
      'dist',
      'bin',
      'openweft.js'
    );

    await execa(process.execPath, [installedCli, '--help'], {
      cwd: workingRoot
    });

    await execa('git', ['init', '-b', 'main'], {
      cwd: workingRoot
    });
    await execa(process.execPath, [installedCli, 'init'], {
      cwd: workingRoot
    });
    const installedSkill = await readFile(
      path.join(workingRoot, 'skills', 'openweft-work-protocol', 'SKILL.md'),
      'utf8'
    );
    if (!installedSkill.includes('OpenWeft Work Protocol')) {
      throw new Error('Packaged CLI init did not scaffold the OpenWeft Work Protocol skill.');
    }

    await execa(process.execPath, [installedCli, 'add', 'add packaged dry-run smoke marker'], {
      cwd: workingRoot
    });
    await execa(process.execPath, [installedCli, 'start', '--dry-run'], {
      cwd: workingRoot
    });

  } finally {
    if (tarballPath !== null) {
      await rm(tarballPath, { force: true });
    }
    await rm(workingRoot, { recursive: true, force: true });
  }
};

await run();
