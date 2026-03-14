import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ToolBlock } from '../../src/ui/ToolBlock.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';

describe('ToolBlock', () => {
  it('renders tool name and args', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <ToolBlock tool="read_file" args="src/index.ts" result="82 lines" success={true} />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('read_file');
    expect(frame).toContain('src/index.ts');
  });
});
