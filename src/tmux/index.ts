import path from 'node:path';

import { execa } from 'execa';

import { ensureDirectory, writeTextFileAtomic } from '../fs/index.js';

export interface TmuxMonitor {
  logDirectory: string;
  slotCount: number;
}

export interface TmuxSpawnInput extends TmuxMonitor {
  cwd: string;
  args: string[];
  processArgv: string[];
  execPath: string;
  sessionName?: string;
}

export interface TmuxSpawnResult {
  sessionName: string;
  slotLogFiles: string[];
}

const shellQuote = (value: string): string => {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
};

export const getTmuxSlotLogFile = (logDirectory: string, slotNumber: number): string => {
  return path.join(logDirectory, `agent-${slotNumber.toString().padStart(2, '0')}.log`);
};

export const prepareTmuxSlotLogs = async (
  logDirectory: string,
  slotCount: number
): Promise<string[]> => {
  const normalizedSlotCount = Math.max(1, slotCount);
  await ensureDirectory(logDirectory);

  const slotLogFiles: string[] = [];
  for (let slotNumber = 1; slotNumber <= normalizedSlotCount; slotNumber += 1) {
    const slotLogFile = getTmuxSlotLogFile(logDirectory, slotNumber);
    slotLogFiles.push(slotLogFile);
    await writeTextFileAtomic(
      slotLogFile,
      `OpenWeft tmux agent slot ${slotNumber}\nWaiting for assignment...\n`
    );
  }

  return slotLogFiles;
};

export const readTmuxMonitorEnv = (
  env: NodeJS.ProcessEnv
): TmuxMonitor | null => {
  if (env.OPENWEFT_TMUX_CHILD !== '1') {
    return null;
  }

  const slotCount = Number.parseInt(env.OPENWEFT_TMUX_SLOT_COUNT ?? '', 10);
  const logDirectory = env.OPENWEFT_TMUX_LOG_DIR?.trim();

  if (!Number.isInteger(slotCount) || slotCount <= 0 || !logDirectory) {
    return null;
  }

  return {
    slotCount,
    logDirectory
  };
};

export const buildTmuxSessionName = (now: Date = new Date()): string => {
  const stamp = [
    now.getUTCFullYear().toString(),
    (now.getUTCMonth() + 1).toString().padStart(2, '0'),
    now.getUTCDate().toString().padStart(2, '0'),
    now.getUTCHours().toString().padStart(2, '0'),
    now.getUTCMinutes().toString().padStart(2, '0'),
    now.getUTCSeconds().toString().padStart(2, '0')
  ].join('');

  return `openweft-${stamp}`;
};

const buildInnerOpenWeftCommand = (input: TmuxSpawnInput): string => {
  const invocationPath = input.processArgv[1];
  if (!invocationPath) {
    throw new Error('Cannot determine the OpenWeft entrypoint for tmux execution.');
  }

  const forwardedArgs = input.args.includes('--stream')
    ? [...input.args]
    : [...input.args, '--stream'];
  const commandParts = invocationPath.endsWith('.ts')
    ? ['tsx', invocationPath, ...forwardedArgs]
    : [input.execPath, invocationPath, ...forwardedArgs];
  const envPrefix = [
    `OPENWEFT_TMUX_CHILD=${shellQuote('1')}`,
    `OPENWEFT_TMUX_SLOT_COUNT=${shellQuote(String(input.slotCount))}`,
    `OPENWEFT_TMUX_LOG_DIR=${shellQuote(input.logDirectory)}`
  ].join(' ');

  return [
    `cd ${shellQuote(input.cwd)}`,
    `${envPrefix} ${commandParts.map((part) => shellQuote(part)).join(' ')}`
  ].join(' && ');
};

const buildTailCommand = (slotLogFile: string, slotNumber: number): string => {
  return [
    `printf '%s\\n' ${shellQuote(`OpenWeft tmux agent slot ${slotNumber}`)}`,
    `touch ${shellQuote(slotLogFile)}`,
    `tail -n +1 -F ${shellQuote(slotLogFile)}`
  ].join(' && ');
};

export const spawnTmuxSession = async (
  input: TmuxSpawnInput
): Promise<TmuxSpawnResult> => {
  const sessionName = input.sessionName ?? buildTmuxSessionName();
  const normalizedInput: TmuxSpawnInput = {
    ...input,
    slotCount: Math.max(1, input.slotCount),
    sessionName
  };
  const slotLogFiles = await prepareTmuxSlotLogs(
    normalizedInput.logDirectory,
    normalizedInput.slotCount
  );
  const targetWindow = `${sessionName}:0`;

  try {
    await execa('tmux', ['new-session', '-d', '-s', sessionName]);
    await execa('tmux', ['set-option', '-t', targetWindow, 'remain-on-exit', 'on']);
    await execa('tmux', ['rename-pane', '-t', `${targetWindow}.0`, 'orchestrator']);
    await execa(
      'tmux',
      ['send-keys', '-t', `${targetWindow}.0`, buildInnerOpenWeftCommand(normalizedInput), 'Enter']
    );

    for (let index = 0; index < slotLogFiles.length; index += 1) {
      const pane = await execa('tmux', [
        'split-window',
        '-t',
        targetWindow,
        '-v',
        '-P',
        '-F',
        '#{pane_id}'
      ]);
      const paneId = pane.stdout.trim();
      const slotNumber = index + 1;

      await execa('tmux', ['set-option', '-t', paneId, 'remain-on-exit', 'on']);
      await execa('tmux', ['rename-pane', '-t', paneId, `agent-${slotNumber}`]);
      await execa(
        'tmux',
        ['send-keys', '-t', paneId, buildTailCommand(slotLogFiles[index]!, slotNumber), 'Enter']
      );
    }

    await execa('tmux', ['select-layout', '-t', targetWindow, 'tiled']);

    return {
      sessionName,
      slotLogFiles
    };
  } catch (error) {
    await execa('tmux', ['kill-session', '-t', sessionName], { reject: false });
    throw error;
  }
};
