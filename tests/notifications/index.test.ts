import { describe, expect, it, vi } from 'vitest';

import {
  createDefaultNotificationDependencies,
  formatNotificationLine,
  sendOpenWeftNotification,
  type NotificationDependencies
} from '../../src/notifications/index.js';

const createDependencies = (
  overrides: Partial<NotificationDependencies> = {}
): NotificationDependencies & {
  writes: string[];
  nativeCalls: Array<{ title: string; message: string; wait?: boolean }>;
} => {
  const writes: string[] = [];
  const nativeCalls: Array<{ title: string; message: string; wait?: boolean }> = [];

  return {
    writes,
    nativeCalls,
    isInteractiveTerminal: () => true,
    notifyNative: async (notification) => {
      nativeCalls.push(notification);
    },
    writeOsc9: (message) => {
      writes.push(`osc9:${message}`);
    },
    writeBell: () => {
      writes.push('bell');
    },
    writeStderr: (message) => {
      writes.push(`stderr:${message}`);
    },
    ...overrides
  };
};

describe('notifications', () => {
  it('formats a default OpenWeft notification line', () => {
    expect(formatNotificationLine({ message: 'Phase complete' })).toBe('OpenWeft: Phase complete');
    expect(formatNotificationLine({ title: 'Custom', message: 'Done' })).toBe('Custom: Done');
  });

  it('uses native notification first and always writes stderr', async () => {
    const dependencies = createDependencies();

    const result = await sendOpenWeftNotification(
      {
        message: 'Phase 2 complete'
      },
      dependencies
    );

    expect(dependencies.nativeCalls).toEqual([
      {
        title: 'OpenWeft',
        message: 'Phase 2 complete'
      }
    ]);
    expect(dependencies.writes).toEqual(['stderr:OpenWeft: Phase 2 complete']);
    expect(result.deliveredChannels).toEqual(['native', 'stderr']);
  });

  it('falls back to OSC 9 when native notifications fail', async () => {
    const dependencies = createDependencies({
      notifyNative: async () => {
        throw new Error('toast unavailable');
      }
    });

    const result = await sendOpenWeftNotification(
      {
        message: 'Queue empty'
      },
      dependencies
    );

    expect(dependencies.writes).toEqual([
      'osc9:OpenWeft: Queue empty',
      'stderr:OpenWeft: Queue empty'
    ]);
    expect(result.attempts).toEqual([
      {
        channel: 'native',
        ok: false,
        error: 'toast unavailable'
      },
      {
        channel: 'osc9',
        ok: true
      },
      {
        channel: 'stderr',
        ok: true
      }
    ]);
  });

  it('falls back to bell when OSC 9 also fails', async () => {
    const dependencies = createDependencies({
      notifyNative: async () => {
        throw new Error('toast unavailable');
      },
      writeOsc9: () => {
        throw new Error('osc unsupported');
      }
    });

    const result = await sendOpenWeftNotification(
      {
        message: 'Budget threshold reached'
      },
      dependencies
    );

    expect(dependencies.writes).toEqual([
      'bell',
      'stderr:OpenWeft: Budget threshold reached'
    ]);
    expect(result.attempts).toEqual([
      {
        channel: 'native',
        ok: false,
        error: 'toast unavailable'
      },
      {
        channel: 'osc9',
        ok: false,
        error: 'osc unsupported'
      },
      {
        channel: 'bell',
        ok: true
      },
      {
        channel: 'stderr',
        ok: true
      }
    ]);
  });

  it('skips terminal signals when there is no interactive terminal', async () => {
    const dependencies = createDependencies({
      isInteractiveTerminal: () => false,
      notifyNative: async () => {
        throw new Error('toast unavailable');
      }
    });

    const result = await sendOpenWeftNotification(
      {
        title: 'OpenWeft',
        message: 'Agent failure'
      },
      dependencies
    );

    expect(dependencies.writes).toEqual(['stderr:OpenWeft: Agent failure']);
    expect(result.deliveredChannels).toEqual(['stderr']);
  });

  it('builds default dependencies around process stderr and node-notifier', async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    const result = createDefaultNotificationDependencies();

    expect(result.isInteractiveTerminal()).toBeTypeOf('boolean');
    result.writeOsc9('OpenWeft: hello');
    result.writeBell();
    result.writeStderr('OpenWeft: line');

    expect(stderrWrite).toHaveBeenCalledTimes(3);
    stderrWrite.mockRestore();
  });
});
