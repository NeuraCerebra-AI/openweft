import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { AgentCard } from '../../src/ui/AgentCard.js';
import type { AgentCardProps } from '../../src/ui/AgentCard.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';
import type { ApprovalRequest } from '../../src/ui/events.js';

const defaults: AgentCardProps = {
  name: 'Alpha',
  feature: 'auth-system',
  status: 'running',
  focused: false,
  files: [],
  tokens: 0,
  elapsed: 83,
  currentTool: null,
  approvalRequest: null,
  spinnerFrame: 0,
  readyStateDetail: null,
};

const renderCard = (overrides: Partial<AgentCardProps> = {}) => {
  const props: AgentCardProps = { ...defaults, ...overrides };
  return render(
    <ThemeContext.Provider value={catppuccinMocha}>
      <AgentCard {...props} />
    </ThemeContext.Provider>
  );
};

describe('AgentCard', () => {
  it('renders agent name and feature', () => {
    const { lastFrame } = renderCard();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Alpha');
    expect(frame).toContain('auth-system');
  });

  it('does not repeat the secondary line when feature matches the name', () => {
    const request = 'make the CLI UI even prettier please';
    const { lastFrame } = renderCard({
      name: request,
      feature: request,
      status: 'queued',
    });
    const frame = lastFrame() ?? '';
    expect(frame.match(new RegExp(request, 'g'))).toHaveLength(1);
  });

  it('shows file count badge when files provided', () => {
    const { lastFrame } = renderCard({ files: ['a.ts', 'b.ts', 'c.ts'] });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('3 files');
  });

  it('shows token badge when tokens > 0', () => {
    const { lastFrame } = renderCard({ tokens: 2500 });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('2.5k tok');
  });

  it('shows file list when focused', () => {
    const { lastFrame } = renderCard({
      focused: true,
      files: ['src/a.ts', 'src/b.ts'],
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('files:');
    expect(frame).toContain('src/a.ts, src/b.ts');
  });

  it('does not show file list when unfocused', () => {
    const { lastFrame } = renderCard({
      focused: false,
      files: ['src/a.ts', 'src/b.ts'],
    });
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('files:');
  });

  it('shows current tool for unfocused running agent', () => {
    const { lastFrame } = renderCard({
      focused: false,
      status: 'running',
      currentTool: 'write_file',
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('▸ write_file');
  });

  it('shows approval box when focused with approval request', () => {
    const approval: ApprovalRequest = {
      file: 'src/index.ts',
      action: 'delete',
      detail: 'This file is no longer needed',
    };
    const { lastFrame } = renderCard({
      focused: true,
      status: 'approval',
      approvalRequest: approval,
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('APPROVAL NEEDED');
    expect(frame).toContain('delete: src/index.ts');
    expect(frame).toContain('This file is no longer needed');
  });

  it('does not show approval box when unfocused', () => {
    const approval: ApprovalRequest = {
      file: 'src/index.ts',
      action: 'delete',
      detail: 'This file is no longer needed',
    };
    const { lastFrame } = renderCard({
      focused: false,
      status: 'approval',
      approvalRequest: approval,
    });
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('APPROVAL NEEDED');
  });

  it('formats tokens below 1000 as plain number', () => {
    const { lastFrame } = renderCard({ tokens: 500 });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('500 tok');
  });

  it('shows ready state detail when focused', () => {
    const { lastFrame } = renderCard({
      focused: true,
      status: 'queued',
      readyStateDetail: 'Waiting for phase 2',
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Waiting for phase 2');
  });

  it('hides ready state detail when unfocused', () => {
    const { lastFrame } = renderCard({
      focused: false,
      status: 'queued',
      readyStateDetail: 'Waiting for phase 2',
    });
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Waiting for phase 2');
  });
});
