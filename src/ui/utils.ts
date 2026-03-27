import type { AgentStatus } from './store.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export interface StatusIconResult {
  readonly icon: string;
  readonly colorKey: 'blue' | 'green' | 'red' | 'muted' | 'yellow';
}

export const getStatusIcon = (status: AgentStatus, spinnerFrame = 0): StatusIconResult => {
  switch (status) {
    case 'running': return { icon: SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0], colorKey: 'blue' };
    case 'completed': return { icon: '✔', colorKey: 'green' };
    case 'failed': return { icon: '✘', colorKey: 'red' };
    case 'queued': return { icon: '◌', colorKey: 'muted' };
    case 'approval': return { icon: '⚑', colorKey: 'yellow' };
  }
};
