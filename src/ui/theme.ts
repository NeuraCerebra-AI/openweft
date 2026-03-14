import { createContext, useContext } from 'react';

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
  readonly pink: string;
  readonly peach: string;
  readonly sky: string;
  readonly teal: string;
  readonly lavender: string;
  readonly green: string;
  readonly red: string;
  readonly yellow: string;
  readonly muted: string;
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
    pink: '#f5c2e7',
    peach: '#fab387',
    sky: '#89dceb',
    teal: '#94e2d5',
    lavender: '#b4befe',
    green: '#a6e3a1',
    red: '#f38ba8',
    yellow: '#f9e2af',
    muted: '#585b70',
  },
  borders: {
    panel: 'single',
    panelActive: 'bold',
    prompt: 'round',
  },
};

export const ThemeContext = createContext<Theme>(catppuccinMocha);

export const useTheme = (): Theme => useContext(ThemeContext);
