import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ModelMenu } from '../../src/ui/ModelMenu.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';

describe('ModelMenu', () => {
  it('renders the active backend, model, effort, and controls', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <ModelMenu
          backend="codex"
          menu={{
            model: 'gpt-5.4',
            effort: 'high',
            focus: 'effort'
          }}
        />
      </ThemeContext.Provider>
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Model + Effort');
    expect(frame).toContain('codex');
    expect(frame).toContain('gpt-5.4');
    expect(frame).toContain('high');
    expect(frame).toContain('Enter save');
    expect(frame).toContain('Esc cancel');
  });
});
