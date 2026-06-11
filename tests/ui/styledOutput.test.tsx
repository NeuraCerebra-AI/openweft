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

  it('renders shared health, meaning, and next action copy when provided', () => {
    const { lastFrame } = render(
      <StatusCard
        appName="OpenWeft"
        health="Review needed"
        meaning="A feature plan needs operator review before execution can continue."
        nextAction="Review the listed feature plan, then rerun openweft start."
        phase="failed"
        usageLabel="Tokens"
        usageValue="0 input / 0 output"
        agents={[]}
      />
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Health: Review needed');
    expect(frame).toContain('Meaning: A feature plan needs operator review before execution can continue.');
    expect(frame).toContain('Next Action: Review the listed feature plan, then rerun openweft start.');
  });

  it('renders checkpoint source and diagnostics summary when provided', () => {
    const { lastFrame } = render(
      <StatusCard
        appName="OpenWeft"
        phase="completed"
        usageLabel="Tokens"
        usageValue="10 input / 5 output"
        checkpointSource="backup"
        diagnosticLines={[
          'Primary Checkpoint Updated: 2026-04-06T14:08:49.618Z',
          'Backup Checkpoint Updated: 2026-04-06T14:08:49.547Z',
          'Backup Semantics: previous snapshot by design',
          'Current HEAD: abc123',
          'Current HEAD Check: verified (1/1 completed features)',
          'Runtime Artifacts: codex-home missing'
        ]}
        agents={[]}
      />
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Checkpoint source: backup');
    expect(frame).toContain('Primary Checkpoint Updated: 2026-04-06T14:08:49.618Z');
    expect(frame).toContain('Backup Semantics: previous snapshot by design');
    expect(frame).toContain('Current HEAD: abc123');
    expect(frame).toContain('Current HEAD Check: verified (1/1 completed features)');
    expect(frame).toContain('Runtime Artifacts: codex-home missing');
  });

  it('renders failed, review, and blocked status rows without success checkmarks', () => {
    const { lastFrame } = render(
      <StatusCard
        appName="OpenWeft"
        phase="failed"
        usageLabel="Tokens"
        usageValue="0 input / 0 output"
        agents={[
          { name: '001 Failed feature', status: 'failed' },
          { name: '002 Needs review', status: 'planning-needs-review' },
          { name: '003 Blocked feature', status: 'blocked-by-failed-feature' },
          { name: '004 Running feature', status: 'running' },
        ]}
      />
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('✗ failed: 001 Failed feature');
    expect(frame).toContain('! review: 002 Needs review');
    expect(frame).toContain('! blocked: 003 Blocked feature');
    expect(frame).toContain('● 004 Running feature');
    expect(frame).not.toContain('✓ 001 Failed feature');
    expect(frame).not.toContain('✓ 002 Needs review');
    expect(frame).not.toContain('✓ 003 Blocked feature');
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
