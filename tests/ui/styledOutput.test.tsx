import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';

const { renderMock } = vi.hoisted(() => ({
  renderMock: vi.fn(),
}));

vi.mock('ink', async (importOriginal) => {
  const original = await importOriginal<typeof import('ink')>();

  return {
    ...original,
    render: renderMock,
  };
});

import { StatusCard, renderStyledOutput } from '../../src/ui/styledOutput.js';

describe('StatusCard', () => {
  beforeEach(() => {
    renderMock.mockReset();
  });

  it('renders pending raw queue entries when they exist', () => {
    const { lastFrame } = render(
      <StatusCard
        appName="OpenWeft"
        phase="planning"
        usageLabel="Tokens"
        usageValue="384000 input / 4000 output"
        pendingRequests={['Add dashboard filters include saved views', 'Refactor auth middleware']}
        agents={[]}
      />
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Phase: planning  Tokens: 384000 input / 4000 output');
    expect(frame).toContain('Pending queue: 2');
    expect(frame).toContain('Add dashboard filters include saved views');
    expect(frame).toContain('Refactor auth middleware');
  });

  it('registers the exit promise before unmounting static styled output', async () => {
    const events: string[] = [];
    let resolveExit: (() => void) | null = null;
    const unmount = vi.fn(() => {
      events.push('unmount');
      resolveExit?.();
    });
    const waitUntilExit = vi.fn(async () => {
      events.push('wait');
      return await new Promise<void>((resolve) => {
        resolveExit = resolve;
      });
    });

    renderMock.mockReturnValue({
      unmount,
      waitUntilExit,
    });

    await renderStyledOutput(
      <StatusCard
        appName="OpenWeft"
        phase="completed"
        usageLabel="Cost"
        usageValue="$0.0000"
        agents={[]}
      />
    );

    expect(events).toEqual(['wait', 'unmount']);
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(waitUntilExit).toHaveBeenCalledTimes(1);
  });
});
