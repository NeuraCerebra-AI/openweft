import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThemeContext, catppuccinMocha } from '../../../src/ui/theme.js';
import { TextInputField } from '../../../src/ui/onboarding/TextInputField.js';

const renderWithTheme = (element: React.ReactElement) =>
  render(<ThemeContext.Provider value={catppuccinMocha}>{element}</ThemeContext.Provider>);

// ink's useInput is registered via useEffect, which runs asynchronously.
// We must wait for the effect to mount before sending key events.
const waitForMount = () => new Promise<void>((r) => setTimeout(r, 50));
const waitForUpdate = () => new Promise<void>((r) => setTimeout(r, 50));

describe('TextInputField', () => {
  it('renders the › prompt and cursor block', () => {
    const { lastFrame } = renderWithTheme(
      <TextInputField
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onExit={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('›');
    expect(frame).toContain('█');
  });

  it('renders the current value', () => {
    const { lastFrame } = renderWithTheme(
      <TextInputField
        value="hello"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onExit={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('hello');
  });

  it('renders the placeholder when value is empty and placeholder is provided', () => {
    const { lastFrame } = renderWithTheme(
      <TextInputField
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onExit={vi.fn()}
        placeholder="Type here..."
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Type here...');
  });

  it('calls onChange when a character is typed', async () => {
    const handleChange = vi.fn();
    const { stdin } = renderWithTheme(
      <TextInputField
        value=""
        onChange={handleChange}
        onSubmit={vi.fn()}
        onExit={vi.fn()}
      />
    );

    await waitForMount();
    stdin.write('h');
    await waitForUpdate();

    expect(handleChange).toHaveBeenCalledWith('h');
  });

  it('calls onChange with appended character when value already has text', async () => {
    const handleChange = vi.fn();
    const { stdin } = renderWithTheme(
      <TextInputField
        value="he"
        onChange={handleChange}
        onSubmit={vi.fn()}
        onExit={vi.fn()}
      />
    );

    await waitForMount();
    stdin.write('y');
    await waitForUpdate();

    expect(handleChange).toHaveBeenCalledWith('hey');
  });

  it('calls onChange with last char removed on Backspace', async () => {
    const handleChange = vi.fn();
    const { stdin } = renderWithTheme(
      <TextInputField
        value="hello"
        onChange={handleChange}
        onSubmit={vi.fn()}
        onExit={vi.fn()}
      />
    );

    await waitForMount();
    stdin.write('\u007F'); // Backspace
    await waitForUpdate();

    expect(handleChange).toHaveBeenCalledWith('hell');
  });

  it('calls onSubmit with trimmed text when Enter is pressed with non-empty value', async () => {
    const handleSubmit = vi.fn();
    const { stdin } = renderWithTheme(
      <TextInputField
        value="  hello world  "
        onChange={vi.fn()}
        onSubmit={handleSubmit}
        onExit={vi.fn()}
      />
    );

    await waitForMount();
    stdin.write('\r'); // Enter
    await waitForUpdate();

    expect(handleSubmit).toHaveBeenCalledOnce();
    expect(handleSubmit).toHaveBeenCalledWith('hello world');
  });

  it('does NOT call onSubmit when Enter is pressed with empty value', async () => {
    const handleSubmit = vi.fn();
    const { stdin } = renderWithTheme(
      <TextInputField
        value=""
        onChange={vi.fn()}
        onSubmit={handleSubmit}
        onExit={vi.fn()}
      />
    );

    await waitForMount();
    stdin.write('\r'); // Enter
    await waitForUpdate();

    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('does NOT call onSubmit when Enter is pressed with whitespace-only value', async () => {
    const handleSubmit = vi.fn();
    const { stdin } = renderWithTheme(
      <TextInputField
        value="   "
        onChange={vi.fn()}
        onSubmit={handleSubmit}
        onExit={vi.fn()}
      />
    );

    await waitForMount();
    stdin.write('\r'); // Enter
    await waitForUpdate();

    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('calls onChange with empty string when Esc is pressed with text present', async () => {
    const handleChange = vi.fn();
    const handleExit = vi.fn();
    const { stdin } = renderWithTheme(
      <TextInputField
        value="some text"
        onChange={handleChange}
        onSubmit={vi.fn()}
        onExit={handleExit}
      />
    );

    await waitForMount();
    stdin.write('\u001B'); // Escape
    await waitForUpdate();

    expect(handleChange).toHaveBeenCalledWith('');
    expect(handleExit).not.toHaveBeenCalled();
  });

  it('calls onExit when Esc is pressed with empty input', async () => {
    const handleExit = vi.fn();
    const { stdin } = renderWithTheme(
      <TextInputField
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onExit={handleExit}
      />
    );

    await waitForMount();
    stdin.write('\u001B'); // Escape
    await waitForUpdate();

    expect(handleExit).toHaveBeenCalledOnce();
  });

  it('renders a bordered box around the input area', () => {
    const { lastFrame } = renderWithTheme(
      <TextInputField
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onExit={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    // Round border top-left corner character
    expect(frame).toContain('╭');
    expect(frame).toContain('╰');
  });
});
