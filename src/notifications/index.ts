import nodeNotifier from 'node-notifier';

export type NotificationChannel = 'native' | 'osc9' | 'bell' | 'stderr';

export interface OpenWeftNotification {
  title?: string;
  message: string;
  wait?: boolean;
}

export interface NotificationAttempt {
  channel: NotificationChannel;
  ok: boolean;
  error?: string;
}

export interface NotificationResult {
  title: string;
  message: string;
  attempts: NotificationAttempt[];
  deliveredChannels: NotificationChannel[];
}

export interface NotificationDependencies {
  isInteractiveTerminal: () => boolean;
  notifyNative: (notification: Required<Pick<OpenWeftNotification, 'title' | 'message'>> & Pick<OpenWeftNotification, 'wait'>) => Promise<void>;
  writeOsc9: (message: string) => void;
  writeBell: () => void;
  writeStderr: (message: string) => void;
}

const DEFAULT_TITLE = 'OpenWeft';

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return String(error);
};

const sanitizeForTerminalSignal = (message: string): string => {
  return message.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
};

export const createDefaultNotificationDependencies = (): NotificationDependencies => ({
  isInteractiveTerminal: () => Boolean(process.stderr.isTTY),
  notifyNative: (notification) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('native notification timed out'));
      }, 500);

      nodeNotifier.notify(notification, (error) => {
        clearTimeout(timer);
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }),
  writeOsc9: (message) => {
    process.stderr.write(`\u001B]9;${sanitizeForTerminalSignal(message)}\u0007`);
  },
  writeBell: () => {
    process.stderr.write('\u0007');
  },
  writeStderr: (message) => {
    process.stderr.write(`${message}\n`);
  }
});

export const formatNotificationLine = (notification: OpenWeftNotification): string => {
  const title = notification.title?.trim() || DEFAULT_TITLE;
  return `${title}: ${notification.message.trim()}`;
};

export const sendOpenWeftNotification = async (
  notification: OpenWeftNotification,
  dependencies: NotificationDependencies = createDefaultNotificationDependencies()
): Promise<NotificationResult> => {
  const title = notification.title?.trim() || DEFAULT_TITLE;
  const message = notification.message.trim();
  const formattedLine = `${title}: ${message}`;
  const attempts: NotificationAttempt[] = [];
  const deliveredChannels: NotificationChannel[] = [];
  const canUseTerminalSignals = dependencies.isInteractiveTerminal();

  try {
    await dependencies.notifyNative({
      title,
      message,
      ...(notification.wait !== undefined ? { wait: notification.wait } : {})
    });
    attempts.push({
      channel: 'native',
      ok: true
    });
    deliveredChannels.push('native');
  } catch (error) {
    attempts.push({
      channel: 'native',
      ok: false,
      error: toErrorMessage(error)
    });

    if (canUseTerminalSignals) {
      try {
        dependencies.writeOsc9(formattedLine);
        attempts.push({
          channel: 'osc9',
          ok: true
        });
        deliveredChannels.push('osc9');
      } catch (oscError) {
        attempts.push({
          channel: 'osc9',
          ok: false,
          error: toErrorMessage(oscError)
        });

        try {
          dependencies.writeBell();
          attempts.push({
            channel: 'bell',
            ok: true
          });
          deliveredChannels.push('bell');
        } catch (bellError) {
          attempts.push({
            channel: 'bell',
            ok: false,
            error: toErrorMessage(bellError)
          });
        }
      }
    }
  }

  try {
    dependencies.writeStderr(formattedLine);
    attempts.push({
      channel: 'stderr',
      ok: true
    });
    deliveredChannels.push('stderr');
  } catch (error) {
    attempts.push({
      channel: 'stderr',
      ok: false,
      error: toErrorMessage(error)
    });
  }

  return {
    title,
    message,
    attempts,
    deliveredChannels
  };
};
