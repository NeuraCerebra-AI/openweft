import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ApprovalPrompt } from '../../src/ui/ApprovalPrompt.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';

describe('ApprovalPrompt', () => {
  it('renders approval title and file', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <ApprovalPrompt file="src/index.ts" action="write" detail="Add auth import" />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('src/index.ts');
    expect(frame).toContain('Approval');
  });
});
