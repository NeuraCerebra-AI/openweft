import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { CodeBlock } from '../../src/ui/CodeBlock.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';

describe('CodeBlock', () => {
  it('renders filename and content', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <CodeBlock filename="src/auth.ts" content="export const x = 1;" language="typescript" />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('src/auth.ts');
    expect(frame).toContain('export const x = 1;');
  });

  it('renders language label', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <CodeBlock filename="main.py" content="print('hello')" language="python" />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('python');
  });
});
