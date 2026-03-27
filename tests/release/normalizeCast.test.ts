import { describe, expect, it } from 'vitest';

import { sanitizeAsciicastV2 } from '../../scripts/normalize-cast.js';

const CLEAR = '\u001b[2J\u001b[3J\u001b[H';

describe('sanitizeAsciicastV2', () => {
  it('merges a clear-screen repaint with its continuation fragments', () => {
    const input = [
      JSON.stringify({ version: 2, width: 100, height: 24, timestamp: 0 }),
      JSON.stringify([0.1, 'o', `${CLEAR}frame-one`]),
      JSON.stringify([0.11, 'o', '\u001b[38;5;102m╰partial-border']),
      JSON.stringify([0.12, 'o', `${CLEAR}frame-two`]),
      JSON.stringify([0.2, 'o', 'tiny-fragment']),
      JSON.stringify([0.3, 'i', 'ignored-input-event']),
    ].join('\n');

    const output = sanitizeAsciicastV2(input).trim().split('\n');

    expect(output).toEqual([
      JSON.stringify({ version: 2, width: 100, height: 24, timestamp: 0 }),
      JSON.stringify([0.1, 'o', `${CLEAR}frame-one\u001b[38;5;102m╰partial-border`]),
      JSON.stringify([0.12, 'o', `${CLEAR}frame-twotiny-fragment`]),
      JSON.stringify([0.3, 'i', 'ignored-input-event']),
    ]);
  });

  it('drops control-only chunks that would otherwise create blank transition frames', () => {
    const input = [
      JSON.stringify({ version: 2, width: 100, height: 24, timestamp: 0 }),
      JSON.stringify([0.1, 'o', `${CLEAR}launch-frame`]),
      JSON.stringify([0.11, 'o', '\u001b[?25l\u001b[?1049h']),
      JSON.stringify([0.12, 'o', `${CLEAR}dashboard-frame`]),
    ].join('\n');

    const output = sanitizeAsciicastV2(input).trim().split('\n');

    expect(output).toEqual([
      JSON.stringify({ version: 2, width: 100, height: 24, timestamp: 0 }),
      JSON.stringify([0.1, 'o', `${CLEAR}launch-frame`]),
      JSON.stringify([0.12, 'o', `${CLEAR}dashboard-frame`]),
    ]);
  });

  it('does not merge cursor-positioned redraw chunks into a full-screen repaint', () => {
    const input = [
      JSON.stringify({ version: 2, width: 100, height: 24, timestamp: 0 }),
      JSON.stringify([0.1, 'o', `${CLEAR}input-frame`]),
      JSON.stringify([0.11, 'o', '\u001b[8;72HEnter submit · ← back ·']),
      JSON.stringify([0.12, 'o', '\u001b[9;2HEsc quit']),
    ].join('\n');

    const output = sanitizeAsciicastV2(input).trim().split('\n');

    expect(output).toEqual([
      JSON.stringify({ version: 2, width: 100, height: 24, timestamp: 0 }),
      JSON.stringify([0.1, 'o', `${CLEAR}input-frame`]),
      JSON.stringify([0.11, 'o', '\u001b[8;72HEnter submit · ← back ·']),
      JSON.stringify([0.12, 'o', '\u001b[9;2HEsc quit']),
    ]);
  });

  it('splits mixed chunks that contain a continuation followed by a new clear-screen frame', () => {
    const nextFrame = `${CLEAR}frame-two with more visible content`;
    const input = [
      JSON.stringify({ version: 2, width: 100, height: 24, timestamp: 0 }),
      JSON.stringify([0.1, 'o', `${CLEAR}frame-one`]),
      JSON.stringify([0.11, 'o', `footer-fragment${nextFrame}`]),
    ].join('\n');

    const output = sanitizeAsciicastV2(input).trim().split('\n');

    expect(output).toEqual([
      JSON.stringify({ version: 2, width: 100, height: 24, timestamp: 0 }),
      JSON.stringify([0.1, 'o', `${CLEAR}frame-onefooter-fragment`]),
      JSON.stringify([0.11, 'o', nextFrame]),
    ]);
  });

  it('moves leading idle time onto a duplicated final frame so the loop restarts on the first real frame', () => {
    const input = [
      JSON.stringify({ version: 2, width: 100, height: 24, timestamp: 0 }),
      JSON.stringify([2.4, 'o', `${CLEAR}welcome-frame`]),
      JSON.stringify([4.0, 'o', `${CLEAR}dashboard-frame`]),
      JSON.stringify([6.5, 'x', '0']),
    ].join('\n');

    const output = sanitizeAsciicastV2(input).trim().split('\n');

    expect(output).toEqual([
      JSON.stringify({ version: 2, width: 100, height: 24, timestamp: 0 }),
      JSON.stringify([0, 'o', `${CLEAR}welcome-frame`]),
      JSON.stringify([1.6, 'o', `${CLEAR}dashboard-frame`]),
      JSON.stringify([4, 'o', `${CLEAR}dashboard-frame`]),
      JSON.stringify([4.1, 'x', '0']),
    ]);
  });

  it('drops a tiny trailing full-screen repaint when it immediately follows a richer frame', () => {
    const input = [
      JSON.stringify({ version: 2, width: 100, height: 24, timestamp: 0 }),
      JSON.stringify([0.1, 'o', `${CLEAR}ready-frame with footer and second card`]),
      JSON.stringify([0.15, 'o', `${CLEAR}partial-running-frame`]),
      JSON.stringify([4.15, 'x', '0']),
    ].join('\n');

    const output = sanitizeAsciicastV2(input).trim().split('\n');

    expect(output).toEqual([
      JSON.stringify({ version: 2, width: 100, height: 24, timestamp: 0 }),
      JSON.stringify([0.1, 'o', `${CLEAR}ready-frame with footer and second card`]),
      JSON.stringify([4.15, 'x', '0']),
    ]);
  });
});
