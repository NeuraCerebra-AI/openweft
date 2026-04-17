import { createContext, useContext } from 'react';

export interface StatusGutterColors {
  readonly running: string;
  readonly completed: string;
  readonly failed: string;
  readonly queued: string;
  readonly approval: string;
  readonly focused: string;
}

export interface ThemeColors {
  readonly bg: string;
  readonly bgDeep: string;
  readonly bgMid: string;
  readonly surface0: string;
  readonly surface1: string;
  readonly surface2: string;
  readonly text: string;
  readonly subtext: string;
  readonly blue: string;
  readonly mauve: string;
  readonly peach: string;
  readonly sky: string;
  readonly teal: string;
  readonly lavender: string;
  readonly green: string;
  readonly red: string;
  readonly yellow: string;
  readonly muted: string;
  // Semantic aliases
  readonly metricTokens: string;
  readonly metricFiles: string;
  readonly statusGutter: StatusGutterColors;
}

export interface ThemeBorders {
  readonly panel: 'single';
  readonly panelActive: 'bold';
  readonly prompt: 'round';
}

export interface Theme {
  readonly colors: ThemeColors;
  readonly borders: ThemeBorders;
}

export const catppuccinMocha: Theme = {
  colors: {
    bg: '#1e1e2e',
    bgDeep: '#11111b',
    bgMid: '#181825',
    surface0: '#313244',
    surface1: '#45475a',
    surface2: '#585b70',
    text: '#cdd6f4',
    subtext: '#a6adc8',
    blue: '#89b4fa',
    mauve: '#cba6f7',
    peach: '#fab387',
    sky: '#89dceb',
    teal: '#94e2d5',
    lavender: '#b4befe',
    green: '#a6e3a1',
    red: '#f38ba8',
    yellow: '#f9e2af',
    muted: '#585b70',
    // Semantic aliases
    metricTokens: '#fab387',  // = peach
    metricFiles: '#a6e3a1',   // = green
    statusGutter: {
      running: '#a6e3a1',     // = green
      completed: '#585b70',   // = surface2/muted
      failed: '#f38ba8',      // = red
      queued: '#94e2d5',      // = teal
      approval: '#f9e2af',    // = yellow
      focused: '#89b4fa',     // = blue
    },
  },
  borders: {
    panel: 'single',
    panelActive: 'bold',
    prompt: 'round',
  },
};

export const ThemeContext = createContext<Theme>(catppuccinMocha);

export const useTheme = (): Theme => useContext(ThemeContext);
