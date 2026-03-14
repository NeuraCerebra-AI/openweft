import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildTmuxSessionName,
  prepareTmuxSlotLogs,
  readTmuxMonitorEnv,
  spawnTmuxSession
} from '../../src/tmux/index.js';

describe('tmux helpers', () => {
  it('parses tmux child environment into a monitor config', () => {
    expect(
      readTmuxMonitorEnv({
        OPENWEFT_TMUX_CHILD: '1',
        OPENWEFT_TMUX_SLOT_COUNT: '3',
        OPENWEFT_TMUX_LOG_DIR: '/tmp/openweft-tmux'
      })
    ).toEqual({
      slotCount: 3,
      logDirectory: '/tmp/openweft-tmux'
    });

    expect(readTmuxMonitorEnv({ OPENWEFT_TMUX_CHILD: '0' })).toBeNull();
    expect(
      readTmuxMonitorEnv({
        OPENWEFT_TMUX_CHILD: '1',
        OPENWEFT_TMUX_SLOT_COUNT: '0',
        OPENWEFT_TMUX_LOG_DIR: '/tmp/openweft-tmux'
      })
    ).toBeNull();
  });

  it('creates deterministic session names and slot log files', async () => {
    expect(buildTmuxSessionName(new Date('2026-03-13T12:34:56Z'))).toBe('openweft-20260313123456');

    const logDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-tmux-'));
    const files = await prepareTmuxSlotLogs(logDirectory, 2);

    expect(files).toEqual([
      path.join(logDirectory, 'agent-01.log'),
      path.join(logDirectory, 'agent-02.log')
    ]);
    await expect(readFile(files[0]!, 'utf8')).resolves.toContain('OpenWeft tmux agent slot 1');
    await expect(readFile(files[1]!, 'utf8')).resolves.toContain('Waiting for assignment...');
  });

  it('executes the tmux session creation sequence through the real execa path', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-fake-tmux-'));
    const tmuxScriptPath = path.join(tempRoot, 'tmux');
    const tmuxLogFile = path.join(tempRoot, 'tmux.log');
    const tmuxCountFile = path.join(tempRoot, 'tmux-count.txt');
    const logDirectory = path.join(tempRoot, 'logs');

    await writeFile(
      tmuxScriptPath,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$OPENWEFT_TMUX_LOG_FILE"
if [ "$1" = "split-window" ]; then
  count=0
  if [ -f "$OPENWEFT_TMUX_COUNT_FILE" ]; then
    count=$(cat "$OPENWEFT_TMUX_COUNT_FILE")
  fi
  count=$((count + 1))
  printf '%s' "$count" > "$OPENWEFT_TMUX_COUNT_FILE"
  printf '%%pane-%s\\n' "$count"
fi
`,
      'utf8'
    );
    await chmod(tmuxScriptPath, 0o755);

    const previousPath = process.env.PATH ?? '';
    const previousLogFile = process.env.OPENWEFT_TMUX_LOG_FILE;
    const previousCountFile = process.env.OPENWEFT_TMUX_COUNT_FILE;

    process.env.PATH = `${tempRoot}:${previousPath}`;
    process.env.OPENWEFT_TMUX_LOG_FILE = tmuxLogFile;
    process.env.OPENWEFT_TMUX_COUNT_FILE = tmuxCountFile;

    try {
      const result = await spawnTmuxSession({
        cwd: '/tmp/repo',
        args: ['start'],
        execPath: '/usr/local/bin/node',
        processArgv: ['node', '/tmp/openweft.js', 'start', '--tmux'],
        logDirectory,
        slotCount: 2,
        sessionName: 'openweft-test'
      });

      expect(result.sessionName).toBe('openweft-test');
      expect(result.slotLogFiles).toEqual([
        path.join(logDirectory, 'agent-01.log'),
        path.join(logDirectory, 'agent-02.log')
      ]);

      const logLines = (await readFile(tmuxLogFile, 'utf8'))
        .trim()
        .split('\n');
      expect(logLines[0]).toBe('new-session -d -s openweft-test');
      expect(logLines.some((line) => line.includes('send-keys -t openweft-test:0.0'))).toBe(true);
      expect(logLines.filter((line) => line.startsWith('split-window '))).toHaveLength(2);
      expect(logLines.some((line) => line.includes('rename-pane -t %pane-1 agent-1'))).toBe(true);
      expect(logLines.some((line) => line.includes('rename-pane -t %pane-2 agent-2'))).toBe(true);
      expect(logLines.at(-1)).toBe('select-layout -t openweft-test:0 tiled');
    } finally {
      process.env.PATH = previousPath;

      if (previousLogFile === undefined) {
        delete process.env.OPENWEFT_TMUX_LOG_FILE;
      } else {
        process.env.OPENWEFT_TMUX_LOG_FILE = previousLogFile;
      }

      if (previousCountFile === undefined) {
        delete process.env.OPENWEFT_TMUX_COUNT_FILE;
      } else {
        process.env.OPENWEFT_TMUX_COUNT_FILE = previousCountFile;
      }
    }
  });
});
