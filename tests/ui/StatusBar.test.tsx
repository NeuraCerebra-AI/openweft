import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StatusBar } from '../../src/ui/StatusBar.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';

describe('StatusBar', () => {
  it('renders app name', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar phase={{ current: 2, total: 4 }} activeCount={3} totalCount={5} cost={0.84} elapsed={272} />
      </ThemeContext.Provider>
    );
    expect(lastFrame()).toContain('openweft');
  });

  it('renders phase info', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar phase={{ current: 2, total: 4 }} activeCount={3} totalCount={5} cost={0.84} elapsed={272} />
      </ThemeContext.Provider>
    );
    expect(lastFrame()).toContain('2/4');
  });

  it('renders cost', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar phase={{ current: 1, total: 1 }} activeCount={1} totalCount={1} cost={1.23} elapsed={60} />
      </ThemeContext.Provider>
    );
    expect(lastFrame()).toContain('$1.23');
  });

  it('omits phase chip when phase is null', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar phase={null} activeCount={0} totalCount={0} cost={0} elapsed={0} />
      </ThemeContext.Provider>
    );
    expect(lastFrame()).toContain('openweft');
    expect(lastFrame()).not.toContain('/');
  });

  it('renders formatted elapsed time', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar phase={null} activeCount={1} totalCount={1} cost={0} elapsed={83} />
      </ThemeContext.Provider>
    );
    expect(lastFrame()).toContain('1:23');
  });
});
