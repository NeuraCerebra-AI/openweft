import { rm } from 'node:fs/promises';
import path from 'node:path';

import { readTextFileIfExists, writeTextFileAtomic } from '../fs/index.js';
import type { RuntimePaths } from '../fs/index.js';

/**
 * One live agent subprocess (codex/claude CLI turn) spawned by the
 * orchestrator. Entries are persisted to a runtime file so that
 * `openweft stop` — running in a different process — can kill in-flight
 * agent process groups even after the orchestrator itself has been
 * SIGKILLed (which bypasses execa's exit-time child cleanup).
 */
export interface AgentProcessEntry {
  pid: number;
  /**
   * Process group id when the child was spawned detached on POSIX
   * (equal to its pid, since it is the group leader); null when no group
   * semantics are available (win32 or non-detached spawn).
   */
  pgid: number | null;
  command: string;
  startedAt: string;
}

export const getAgentProcessRegistryFile = (
  paths: Pick<RuntimePaths, 'openweftDir'>
): string => path.join(paths.openweftDir, 'agent-pids.json');

export const readAgentProcessRegistry = async (
  registryFile: string
): Promise<AgentProcessEntry[]> => {
  const content = await readTextFileIfExists(registryFile);
  if (content === null) {
    return [];
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return [];
    }
    const entries = (parsed as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) {
      return [];
    }

    return entries.flatMap((candidate): AgentProcessEntry[] => {
      if (typeof candidate !== 'object' || candidate === null) {
        return [];
      }
      const record = candidate as Record<string, unknown>;
      if (typeof record.pid !== 'number' || !Number.isInteger(record.pid) || record.pid <= 0) {
        return [];
      }
      return [
        {
          pid: record.pid,
          pgid:
            typeof record.pgid === 'number' && Number.isInteger(record.pgid) && record.pgid > 0
              ? record.pgid
              : null,
          command: typeof record.command === 'string' ? record.command : '',
          startedAt: typeof record.startedAt === 'string' ? record.startedAt : ''
        }
      ];
    });
  } catch {
    return [];
  }
};

/**
 * Selects what to signal for each recorded agent process. On POSIX the
 * whole process group is targeted (negative pid) so grandchildren spawned
 * by the agent CLI die too; on win32 (no pgid semantics) it falls back to
 * the plain child pid.
 */
export const resolveAgentKillTargets = (
  entries: readonly AgentProcessEntry[],
  platform: NodeJS.Platform = process.platform
): number[] => {
  const targets = new Set<number>();
  for (const entry of entries) {
    if (platform !== 'win32' && entry.pgid !== null) {
      targets.add(-entry.pgid);
    } else {
      targets.add(entry.pid);
    }
  }
  return [...targets];
};

export interface AgentProcessRegistry {
  register(entry: AgentProcessEntry): Promise<void>;
  unregister(pid: number): Promise<void>;
  /** Drops all entries and removes the registry file. */
  clear(): Promise<void>;
  /** Removes the process exit hook installed by the registry. */
  dispose(): void;
}

export const createAgentProcessRegistry = (input: {
  registryFile: string;
  platform?: NodeJS.Platform;
}): AgentProcessRegistry => {
  const platform = input.platform ?? process.platform;
  const entries = new Map<number, AgentProcessEntry>();
  let queue: Promise<void> = Promise.resolve();

  const persist = async (): Promise<void> => {
    if (entries.size === 0) {
      await rm(input.registryFile, { force: true });
      return;
    }

    await writeTextFileAtomic(
      input.registryFile,
      `${JSON.stringify({ version: 1, entries: [...entries.values()] }, null, 2)}\n`
    );
  };

  const enqueue = (mutation: () => Promise<void>): Promise<void> => {
    const next = queue.then(mutation);
    queue = next.catch(() => {});
    return next;
  };

  // Detached children are no longer covered by execa's cleanup-on-exit, so
  // restore that safety net ourselves: if the orchestrator exits while agent
  // turns are still registered (crash, unhandled rejection), kill their
  // process groups synchronously on the way out.
  const exitHandler = (): void => {
    if (platform === 'win32') {
      return;
    }
    for (const entry of entries.values()) {
      if (entry.pgid === null) {
        continue;
      }
      try {
        process.kill(-entry.pgid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  };
  process.on('exit', exitHandler);

  return {
    register: (entry) =>
      enqueue(async () => {
        entries.set(entry.pid, entry);
        await persist();
      }),
    unregister: (pid) =>
      enqueue(async () => {
        if (entries.delete(pid)) {
          await persist();
        }
      }),
    clear: () =>
      enqueue(async () => {
        entries.clear();
        await rm(input.registryFile, { force: true });
      }),
    dispose: () => {
      process.off('exit', exitHandler);
    }
  };
};
