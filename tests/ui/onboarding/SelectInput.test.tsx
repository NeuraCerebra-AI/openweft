import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThemeContext, catppuccinMocha } from '../../../src/ui/theme.js';
import { SelectInput } from '../../../src/ui/onboarding/SelectInput.js';

const options = [
  { label: 'A', value: 'a' },
  { label: 'B', value: 'b' },
] as const;

const renderWithTheme = (element: React.ReactElement) =>
  render(<ThemeContext.Provider value={catppuccinMocha}>{element}</ThemeContext.Provider>);

// ink's useInput is registered via useEffect, which runs asynchronously.
// We must wait for the effect to mount before sending key events.
const waitForMount = () => new Promise<void>((r) => setTimeout(r, 50));
const waitForUpdate = () => new Promise<void>((r) => setTimeout(r, 50));

describe('SelectInput', () => {
  it('renders all option labels', () => {
    const { lastFrame } = renderWithTheme(
      <SelectInput options={options} onSelect={vi.fn()} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('A');
    expect(frame).toContain('B');
  });

  it('shows › indicator on the first option by default', () => {
    const { lastFrame } = renderWithTheme(
      <SelectInput options={options} onSelect={vi.fn()} />
    );
    const frame = lastFrame() ?? '';
    // First line has indicator, second does not
    const lines = frame.split('\n');
    expect(lines[0]).toContain('›');
    expect(lines[1]).not.toContain('›');
  });

  it('moves › indicator to second option after down arrow', async () => {
    const { lastFrame, stdin } = renderWithTheme(
      <SelectInput options={options} onSelect={vi.fn()} />
    );

    await waitForMount();
    stdin.write('\u001B[B'); // down arrow
    await waitForUpdate();

    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    // Now second line (B) should have the indicator
    expect(lines[0]).not.toContain('›');
    expect(lines[1]).toContain('›');
  });

  it('calls onSelect with correct value when Enter is pressed on second option', async () => {
    const handleSelect = vi.fn();
    const { stdin } = renderWithTheme(
      <SelectInput options={options} onSelect={handleSelect} />
    );

    await waitForMount();
    stdin.write('\u001B[B'); // move to B
    await waitForUpdate();
    stdin.write('\r'); // confirm
    await waitForUpdate();

    expect(handleSelect).toHaveBeenCalledOnce();
    expect(handleSelect).toHaveBeenCalledWith('b');
  });

  it('calls onSelect with first option value when Enter is pressed without moving', async () => {
    const handleSelect = vi.fn();
    const { stdin } = renderWithTheme(
      <SelectInput options={options} onSelect={handleSelect} />
    );

    await waitForMount();
    stdin.write('\r');
    await waitForUpdate();

    expect(handleSelect).toHaveBeenCalledOnce();
    expect(handleSelect).toHaveBeenCalledWith('a');
  });

  it('wraps from last to first option on down arrow', async () => {
    const { lastFrame, stdin } = renderWithTheme(
      <SelectInput options={options} onSelect={vi.fn()} />
    );

    await waitForMount();
    stdin.write('\u001B[B'); // move to B (index 1, last)
    await waitForUpdate();
    stdin.write('\u001B[B'); // wrap back to A (index 0)
    await waitForUpdate();

    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    // Should be back at first option
    expect(lines[0]).toContain('›');
    expect(lines[1]).not.toContain('›');
  });

  it('wraps from first to last option on up arrow', async () => {
    const { lastFrame, stdin } = renderWithTheme(
      <SelectInput options={options} onSelect={vi.fn()} />
    );

    await waitForMount();
    stdin.write('\u001B[A'); // up arrow from first option → wraps to last
    await waitForUpdate();

    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    // Should now be at last option (B)
    expect(lines[0]).not.toContain('›');
    expect(lines[1]).toContain('›');
  });

  it('renders hint text after the label when provided', () => {
    const optionsWithHint = [
      { label: 'Option A', value: 'a', hint: 'some hint' },
      { label: 'Option B', value: 'b' },
    ] as const;

    const { lastFrame } = renderWithTheme(
      <SelectInput options={optionsWithHint} onSelect={vi.fn()} />
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('some hint');
  });
});
