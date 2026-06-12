import { execa } from 'execa';

/**
 * Marker recorded in every pid file written by this version of OpenWeft.
 * It documents which program wrote the file; process identity itself is
 * verified via the recorded process start time, not this marker.
 */
export const OPENWEFT_PID_ARGV_MARKER = 'openweft';

export interface PidFileRecord {
  pid: number;
  /** ISO timestamp of when the pid file was written. */
  startedAt: string;
  argvMarker: string;
  /**
   * Kernel-reported start time of the owning process (`ps -o lstart=`) at
   * write time, or null on platforms where it cannot be read (win32).
   * Comparing this against the live process guards against PID reuse.
   */
  processStartTime: string | null;
}

export type ParsedPidFile =
  | { kind: 'json'; record: PidFileRecord }
  | { kind: 'legacy'; pid: number }
  | { kind: 'invalid' };

export const serializePidFileRecord = (record: PidFileRecord): string =>
  `${JSON.stringify(record, null, 2)}\n`;

export const parsePidFileContent = (content: string): ParsedPidFile => {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { kind: 'invalid' };
  }

  if (/^\d+$/.test(trimmed)) {
    const pid = Number.parseInt(trimmed, 10);
    return Number.isInteger(pid) && pid > 0
      ? { kind: 'legacy', pid }
      : { kind: 'invalid' };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const candidate = parsed as Record<string, unknown>;
      const pid = candidate.pid;
      if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0) {
        return {
          kind: 'json',
          record: {
            pid,
            startedAt: typeof candidate.startedAt === 'string' ? candidate.startedAt : '',
            argvMarker:
              typeof candidate.argvMarker === 'string'
                ? candidate.argvMarker
                : OPENWEFT_PID_ARGV_MARKER,
            processStartTime:
              typeof candidate.processStartTime === 'string'
                ? candidate.processStartTime
                : null
          }
        };
      }
    }
  } catch {
    // fall through to invalid
  }

  return { kind: 'invalid' };
};

/**
 * Default process-identity probe: the kernel-reported start time of a pid.
 * Returns null when it cannot be determined (no such process, no `ps`
 * binary, or win32), in which case callers must degrade conservatively.
 */
export const getProcessStartTimeViaPs = async (pid: number): Promise<string | null> => {
  if (process.platform === 'win32') {
    return null;
  }

  try {
    const result = await execa('ps', ['-o', 'lstart=', '-p', String(pid)], {
      reject: false
    });
    if (result.exitCode !== 0) {
      return null;
    }
    const value = (result.stdout ?? '').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
};
