import { describe, it, expect } from 'vitest';
import { catppuccinMocha, type Theme } from '../../src/ui/theme.js';

describe('theme', () => {
  it('exports catppuccinMocha with all required color keys', () => {
    const requiredKeys = [
      'bg', 'bgDeep', 'bgMid', 'surface0', 'surface1', 'surface2',
      'text', 'subtext', 'blue', 'mauve', 'pink', 'peach', 'sky',
      'teal', 'lavender', 'green', 'red', 'yellow', 'muted',
    ];
    for (const key of requiredKeys) {
      expect(catppuccinMocha.colors).toHaveProperty(key);
      expect(catppuccinMocha.colors[key as keyof Theme['colors']]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('exports border styles mapping to Ink borderStyle values', () => {
    expect(catppuccinMocha.borders.panel).toBe('single');
    expect(catppuccinMocha.borders.panelActive).toBe('bold');
    expect(catppuccinMocha.borders.prompt).toBe('round');
  });
});
