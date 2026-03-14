#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { execa } from 'execa';

const validBackends = new Set(['codex', 'claude']);
const validScenarios = new Set(['single', 'resume']);
const backend = process.argv[2];
const scenario = process.argv[3] ?? 'single';

if (!backend || !validBackends.has(backend) || !validScenarios.has(scenario)) {
  console.error('Usage: node scripts/live-smoke.mjs <codex|claude> [single|resume]');
  process.exit(1);
}

const repoRoot = path.resolve(path.join(import.meta.dirname, '..'));
const cliEntrypoint = path.join(repoRoot, 'dist', 'bin', 'openweft.js');
const tempRepo = await mkdtemp(path.join(os.tmpdir(), `openweft-live-smoke-${backend}-`));
const targetFile =
  scenario === 'resume'
    ? path.join('docs', `${backend}-live-smoke-resume.txt`)
    : path.join('docs', `${backend}-live-smoke.md`);
const featureRequests =
  scenario === 'resume'
    ? [
        `create ${targetFile} with exactly this line and no other text: ${backend} resume smoke phase one`,
        `modify ${targetFile} by appending exactly this new line while preserving existing content: ${backend} resume smoke phase two`,
        `modify ${targetFile} by appending exactly this new line while preserving existing content: ${backend} resume smoke phase three`
      ]
    : [`create ${targetFile} with one short sentence confirming the ${backend} live smoke passed`];

const readJsonLines = async (filePath) => {
  const content = await readFile(filePath, 'utf8');
  return content
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
};

const run = async (command, args, options = {}) => {
  return execa(command, args, {
    cwd: tempRepo,
    reject: false,
    ...options
  });
};

const runOpenWeft = async (args) => {
  const result = await execa(process.execPath, [cliEntrypoint, ...args], {
    cwd: tempRepo,
    reject: false,
    stripFinalNewline: false
  });

  if (result.exitCode !== 0) {
    throw new Error(
      [
        `OpenWeft command failed: node ${cliEntrypoint} ${args.join(' ')}`,
        result.stdout.trim(),
        result.stderr.trim()
      ]
        .filter((line) => line.length > 0)
        .join('\n')
    );
  }

  return result;
};

const cleanup = async () => {
  if (process.env.OPENWEFT_KEEP_SMOKE_REPO === '1') {
    console.log(`Keeping smoke repo at ${tempRepo}`);
    return;
  }

  await rm(tempRepo, { recursive: true, force: true });
};

try {
  const authCommand =
    backend === 'codex'
      ? ['codex', ['login', 'status']]
      : ['claude', ['auth', 'status']];
  const auth = await execa(authCommand[0], authCommand[1], {
    reject: false,
    stripFinalNewline: false
  });

  if (auth.exitCode !== 0) {
    throw new Error(`${backend} CLI auth check failed.\n${auth.stdout}\n${auth.stderr}`);
  }

  await run('git', ['init', '-b', 'main']);
  await run('git', ['config', 'user.name', 'OpenWeft Smoke']);
  await run('git', ['config', 'user.email', 'openweft-smoke@example.com']);
  await writeFile(path.join(tempRepo, 'README.md'), '# OpenWeft Live Smoke\n', 'utf8');
  await run('git', ['add', 'README.md']);
  await run('git', ['commit', '-m', 'initial commit']);

  await runOpenWeft(['init']);

  await writeFile(
    path.join(tempRepo, '.openweftrc.json'),
    `${JSON.stringify(
      {
        backend,
        concurrency: {
          maxParallelAgents: 1,
          staggerDelayMs: 0
        }
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  await mkdir(path.join(tempRepo, 'prompts'), { recursive: true });
  await writeFile(
    path.join(tempRepo, 'prompts', 'prompt-a.md'),
    [
      `You are preparing Prompt B for a tiny OpenWeft ${scenario} live smoke test.`,
      '',
      'User request:',
      '{{USER_REQUEST}}',
      '',
      'Return Prompt B only. Prompt B must instruct the next agent to generate a compact Markdown feature plan that:',
      '- produces the smallest safe implementation',
      '- includes 3-5 steps',
      '- includes a strict `## Manifest` section with a JSON code block containing `create`, `modify`, and `delete` arrays',
      '- prefers creating exactly the requested file and no unrelated edits',
      '- includes targeted validation'
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    path.join(tempRepo, 'prompts', 'plan-adjustment.md'),
    [
      'Review these merged edits:',
      '{{CODE_EDIT_SUMMARY}}',
      '',
      'Investigate whether they interfere with the referenced feature plan.',
      'If they do, update the plan file in place, including the manifest.',
      'If they do not, leave the plan unchanged.'
    ].join('\n'),
    'utf8'
  );

  for (const featureRequest of featureRequests) {
    await runOpenWeft(['add', featureRequest]);
  }

  const startResult = await runOpenWeft(['start']);
  const createdFile = path.join(tempRepo, targetFile);
  const createdContent = await readFile(createdFile, 'utf8');
  const checkpoint = JSON.parse(
    await readFile(path.join(tempRepo, '.openweft', 'checkpoint.json'), 'utf8')
  );

  if (checkpoint.status !== 'completed') {
    throw new Error(`Smoke checkpoint did not complete successfully: ${checkpoint.status}`);
  }

  if (scenario === 'resume') {
    const expectedPhaseOne = `${backend} resume smoke phase one`;
    const expectedPhaseTwo = `${backend} resume smoke phase two`;
    const expectedPhaseThree = `${backend} resume smoke phase three`;

    if (
      !createdContent.includes(expectedPhaseOne) ||
      !createdContent.includes(expectedPhaseTwo) ||
      !createdContent.includes(expectedPhaseThree)
    ) {
      throw new Error(
        [
          'Resume smoke file content did not contain all expected phase markers.',
          createdContent.trim()
        ].join('\n')
      );
    }

    const auditEntries = await readJsonLines(path.join(tempRepo, '.openweft', 'audit-trail.jsonl'));
    const initialAdjustmentTurn = auditEntries.find(
      (entry) =>
        entry.event === 'agent.turn.completed' &&
        entry.data?.featureId === '002' &&
        entry.data?.stage === 'adjustment'
    );
    const resumedAdjustmentTurn = auditEntries.find(
      (entry) =>
        entry.event === 'agent.turn.start' &&
        entry.data?.featureId === '003' &&
        entry.data?.stage === 'adjustment' &&
        entry.data?.resumedSession === true &&
        Array.isArray(entry.data?.command?.args) &&
        entry.data.command.args.includes('resume')
    );
    const featureThreeExecutionTurn = auditEntries.find(
      (entry) =>
        entry.event === 'agent.turn.start' &&
        entry.data?.featureId === '003' &&
        entry.data?.stage === 'execution'
    );

    if (!initialAdjustmentTurn) {
      throw new Error('Resume smoke did not observe the expected adjustment turn for feature 002.');
    }

    if (!resumedAdjustmentTurn) {
      throw new Error('Resume smoke did not observe a resumed adjustment turn for feature 003.');
    }

    if (featureThreeExecutionTurn?.data?.resumedSession !== false) {
      throw new Error('Resume smoke expected feature 003 execution to start fresh after repo-scoped adjustments.');
    }
  }

  console.log(`Backend: ${backend}`);
  console.log(`Scenario: ${scenario}`);
  console.log(`Temp repo: ${tempRepo}`);
  console.log(`Feature requests: ${featureRequests.join(' | ')}`);
  console.log(`CLI output: ${startResult.stdout.trim()}`);
  console.log(`Created file: ${targetFile}`);
  console.log(`Created content: ${createdContent.trim()}`);

  await cleanup();
} catch (error) {
  console.error(`Live smoke failed for ${backend}. Temp repo preserved at ${tempRepo}.`);
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
}
