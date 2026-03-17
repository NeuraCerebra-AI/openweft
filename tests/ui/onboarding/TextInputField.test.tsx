import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThemeContext, catppuccinMocha } from '../../../src/ui/theme.js';
import { TextInputField } from '../../../src/ui/onboarding/TextInputField.js';
import { MAX_PASTE_CHARS } from '../../../src/ui/onboarding/paste.js';

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

// ---------------------------------------------------------------------------
// Paste handling integration tests
// ---------------------------------------------------------------------------

/** Wrapper that manages its own state so paste refs (map, ID counter) work end-to-end. */
const StatefulWrapper: React.FC<{
  onSubmit?: (text: string) => void;
  onExit?: () => void;
}> = ({ onSubmit = vi.fn(), onExit = vi.fn() }) => {
  const [value, setValue] = React.useState('');
  return (
    <ThemeContext.Provider value={catppuccinMocha}>
      <TextInputField value={value} onChange={setValue} onSubmit={onSubmit} onExit={onExit} />
    </ThemeContext.Provider>
  );
};

const InteractiveWrapper: React.FC<{
  initialValue?: string;
  onSubmit?: (text: string) => void;
  onExit?: () => void;
}> = ({ initialValue = '', onSubmit = vi.fn(), onExit = vi.fn() }) => {
  const [value, setValue] = React.useState(initialValue);

  return (
    <ThemeContext.Provider value={catppuccinMocha}>
      <TextInputField value={value} onChange={setValue} onSubmit={onSubmit} onExit={onExit} />
    </ThemeContext.Provider>
  );
};

describe('paste handling', () => {
  describe('(0) cursor-aware editing', () => {
    it('inserts typed text at the cursor after moving left', async () => {
      const { stdin, lastFrame } = render(<InteractiveWrapper initialValue="helo" />);
      await waitForMount();

      stdin.write('\u001B[D');
      await waitForUpdate();
      stdin.write('l');
      await waitForUpdate();

      const frame = lastFrame() ?? '';
      expect(frame).toContain('hell');
      expect(frame).toContain('█o');
    });

    it('deletes the previous word on meta-delete sequences Ink surfaces', async () => {
      const { stdin, lastFrame } = render(<InteractiveWrapper initialValue="hello world" />);
      await waitForMount();

      stdin.write('\u001B\u007F');
      await waitForUpdate();

      const frame = lastFrame() ?? '';
      expect(frame).toContain('hello ');
      expect(frame).not.toContain('world');
    });
  });

  describe('(a) inline paste (below threshold)', () => {
    it('inlines short multi-char paste via onChange', async () => {
      const handleChange = vi.fn();
      const { stdin } = renderWithTheme(
        <TextInputField value="" onChange={handleChange} onSubmit={vi.fn()} onExit={vi.fn()} />,
      );
      await waitForMount();
      stdin.write('hi');
      await waitForUpdate();
      expect(handleChange).toHaveBeenCalledWith('hi');
    });

    it('converts tab characters to four spaces in pasted text', async () => {
      const handleChange = vi.fn();
      const { stdin } = renderWithTheme(
        <TextInputField value="" onChange={handleChange} onSubmit={vi.fn()} onExit={vi.fn()} />,
      );
      await waitForMount();
      stdin.write('a\tb');
      await waitForUpdate();
      expect(handleChange).toHaveBeenCalledWith('a    b');
    });

    it('appends inlined paste after existing text', async () => {
      const handleChange = vi.fn();
      const { stdin } = renderWithTheme(
        <TextInputField value="hello " onChange={handleChange} onSubmit={vi.fn()} onExit={vi.fn()} />,
      );
      await waitForMount();
      stdin.write('world');
      await waitForUpdate();
      expect(handleChange).toHaveBeenCalledWith('hello world');
    });

    it('inlines paste at exactly 800 characters (boundary)', async () => {
      const handleChange = vi.fn();
      const { stdin } = renderWithTheme(
        <TextInputField value="" onChange={handleChange} onSubmit={vi.fn()} onExit={vi.fn()} />,
      );
      await waitForMount();
      stdin.write('x'.repeat(800));
      await waitForUpdate();
      expect(handleChange).toHaveBeenCalledWith('x'.repeat(800));
    });

    it('inlines paste with exactly 2 newlines (boundary)', async () => {
      const handleChange = vi.fn();
      const { stdin } = renderWithTheme(
        <TextInputField value="" onChange={handleChange} onSubmit={vi.fn()} onExit={vi.fn()} />,
      );
      await waitForMount();
      stdin.write('a\nb\nc');
      await waitForUpdate();
      expect(handleChange).toHaveBeenCalledWith('a\nb\nc');
    });
  });

  describe('(b) collapsed paste (above threshold)', () => {
    it('collapses paste at 801 characters into a token (boundary)', async () => {
      const handleChange = vi.fn();
      const { stdin } = renderWithTheme(
        <TextInputField value="" onChange={handleChange} onSubmit={vi.fn()} onExit={vi.fn()} />,
      );
      await waitForMount();
      stdin.write('x'.repeat(801));
      await waitForUpdate();
      expect(handleChange).toHaveBeenCalledWith('[Pasted text #1]');
    });

    it('collapses paste with 3 newlines into token with line count (boundary)', async () => {
      const handleChange = vi.fn();
      const { stdin } = renderWithTheme(
        <TextInputField value="" onChange={handleChange} onSubmit={vi.fn()} onExit={vi.fn()} />,
      );
      await waitForMount();
      stdin.write('a\nb\nc\nd');
      await waitForUpdate();
      expect(handleChange).toHaveBeenCalledWith('[Pasted text #1 +3 lines]');
    });

    it('includes correct line count for multi-line paste', async () => {
      const handleChange = vi.fn();
      const { stdin } = renderWithTheme(
        <TextInputField value="" onChange={handleChange} onSubmit={vi.fn()} onExit={vi.fn()} />,
      );
      await waitForMount();
      const lines = Array.from({ length: 11 }, (_, i) => 'line' + String(i)).join('\n');
      stdin.write(lines);
      await waitForUpdate();
      expect(handleChange).toHaveBeenCalledWith('[Pasted text #1 +10 lines]');
    });

    it('truncates paste exceeding MAX_PASTE_CHARS before collapsing', async () => {
      const handleChange = vi.fn();
      const { stdin } = renderWithTheme(
        <TextInputField value="" onChange={handleChange} onSubmit={vi.fn()} onExit={vi.fn()} />,
      );
      await waitForMount();
      stdin.write('x'.repeat(11_000));
      await waitForUpdate();
      expect(handleChange).toHaveBeenCalledWith('[Pasted text #1]');
    });

    it('appends collapse token after existing text', async () => {
      const handleChange = vi.fn();
      const { stdin } = renderWithTheme(
        <TextInputField value="prefix " onChange={handleChange} onSubmit={vi.fn()} onExit={vi.fn()} />,
      );
      await waitForMount();
      stdin.write('x'.repeat(801));
      await waitForUpdate();
      expect(handleChange).toHaveBeenCalledWith('prefix [Pasted text #1]');
    });
  });

  describe('(c) token display', () => {
    it('displays paste token verbatim in the rendered frame', () => {
      const { lastFrame } = renderWithTheme(
        <TextInputField
          value="typed [Pasted text #1]"
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          onExit={vi.fn()}
        />,
      );
      const frame = lastFrame() ?? '';
      expect(frame).toContain('[Pasted text #1]');
    });
  });

  describe('(d) backspace with tokens', () => {
    it('deletes entire paste token on backspace when value ends with token', async () => {
      const handleChange = vi.fn();
      const { stdin } = renderWithTheme(
        <TextInputField
          value="prefix [Pasted text #1]"
          onChange={handleChange}
          onSubmit={vi.fn()}
          onExit={vi.fn()}
        />,
      );
      await waitForMount();
      stdin.write('\u007F');
      await waitForUpdate();
      expect(handleChange).toHaveBeenCalledWith('prefix ');
    });

    it('performs normal single-char delete when token is not at end', async () => {
      const handleChange = vi.fn();
      const { stdin } = renderWithTheme(
        <TextInputField
          value="[Pasted text #1] x"
          onChange={handleChange}
          onSubmit={vi.fn()}
          onExit={vi.fn()}
        />,
      );
      await waitForMount();
      stdin.write('\u007F');
      await waitForUpdate();
      expect(handleChange).toHaveBeenCalledWith('[Pasted text #1] ');
    });
  });

  describe('(e) stateful paste flows', () => {
    it('assigns unique sequential IDs to multiple pastes', async () => {
      const { stdin, lastFrame } = render(<StatefulWrapper />);
      await waitForMount();
      stdin.write('x'.repeat(801));
      await waitForUpdate();
      stdin.write('y'.repeat(801));
      await waitForUpdate();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('[Pasted text #1]');
      expect(frame).toContain('[Pasted text #2]');
    });

    it('resolves collapsed token to actual content on submit', async () => {
      const handleSubmit = vi.fn();
      const longText = 'a'.repeat(801);
      const { stdin } = render(<StatefulWrapper onSubmit={handleSubmit} />);
      await waitForMount();
      stdin.write(longText);
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();
      expect(handleSubmit).toHaveBeenCalledOnce();
      expect(handleSubmit).toHaveBeenCalledWith(longText);
    });

    it('resolves mixed typed text and paste token on submit', async () => {
      const handleSubmit = vi.fn();
      const longText = 'z'.repeat(801);
      const { stdin } = render(<StatefulWrapper onSubmit={handleSubmit} />);
      await waitForMount();
      stdin.write('A');
      await waitForUpdate();
      stdin.write('d');
      await waitForUpdate();
      stdin.write('d');
      await waitForUpdate();
      stdin.write(' ');
      await waitForUpdate();
      stdin.write(longText);
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();
      expect(handleSubmit).toHaveBeenCalledOnce();
      expect(handleSubmit).toHaveBeenCalledWith('Add ' + longText);
    });

    it('resets paste IDs after Esc clears value', async () => {
      const { stdin, lastFrame } = render(<StatefulWrapper />);
      await waitForMount();
      stdin.write('x'.repeat(801));
      await waitForUpdate();
      expect((lastFrame() ?? '')).toContain('[Pasted text #1]');
      // Esc clears value → useEffect resets refs
      stdin.write('\u001B');
      await waitForUpdate();
      // Paste again — should get #1, not #2
      stdin.write('y'.repeat(801));
      await waitForUpdate();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('[Pasted text #1]');
      expect(frame).not.toContain('[Pasted text #2]');
    });

    it('resolves truncated paste to exactly MAX_PASTE_CHARS on submit', async () => {
      const handleSubmit = vi.fn();
      const { stdin } = render(<StatefulWrapper onSubmit={handleSubmit} />);
      await waitForMount();
      stdin.write('a'.repeat(11_000));
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();
      expect(handleSubmit).toHaveBeenCalledOnce();
      const submitted = handleSubmit.mock.calls[0]?.[0] as string;
      expect(submitted.length).toBe(MAX_PASTE_CHARS);
    });

    it('keeps collapsed paste tokens atomic when moving left and typing', async () => {
      const { stdin, lastFrame } = render(<StatefulWrapper />);
      await waitForMount();

      stdin.write('prefix ');
      await waitForUpdate();
      stdin.write('x'.repeat(801));
      await waitForUpdate();
      stdin.write('\u001B[D');
      await waitForUpdate();
      stdin.write('A');
      await waitForUpdate();

      const frame = lastFrame() ?? '';
      expect(frame).toContain('prefix A');
      expect(frame).toContain('█[Pasted text #1]');
    });
  });
});
