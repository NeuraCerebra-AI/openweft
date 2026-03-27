import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

import { useTheme } from './theme.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';

interface EmptyStateProps {
  readonly dissolving: boolean;
  readonly onDissolved?: () => void;
}

// Exact character sets from the prototype
const WARP = ['│', '┃', '╎', '╏', '┊', '┆'];
const WEFT = ['─', '━', '╌', '╍', '┈', '┄'];
const CROSS = ['┼', '╋', '╬', '◇', '◆', '✦', '⬥'];

const FRAME_MS = 150;
const DISSOLVE_FRAMES = 12;

// Prototype grid was 50 cols × 22 rows — terminal is ~160×40+.
// Scale wave frequencies so the pattern has the same visual density.
const PROTO_COLS = 50;
const PROTO_ROWS = 22;

interface FC {
  readonly palette: readonly string[];
  readonly bg: string;
  readonly surface0: string;
  readonly surface1: string;
  readonly textColor: string;
  readonly subtext: string;
  readonly blue: string;
}

/** Deterministic pseudo-random for cross chars (avoids Math.random flicker) */
function pseudoRand(r: number, c: number, tick: number): number {
  let h = r * 2654435761 + c * 2246822519 + tick * 3266489917;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  return ((h >>> 16) ^ h) & 0x7;
}

/** Build one loom character — exact prototype math, frequency-scaled */
function loomChar(
  r: number, c: number, tick: number,
  colScale: number, rowScale: number,
  fc: FC,
): string {
  // Scale coordinates so the wave pattern matches 50×22 prototype proportions
  const sc = c * colScale;
  const sr = r * rowScale;

  // Exact prototype wave math
  const wave1 = Math.sin(sc * 0.15 + tick * 0.04 + sr * 0.1);
  const wave2 = Math.cos(sr * 0.12 + tick * 0.03 + sc * 0.08);
  const combined = (wave1 + wave2) / 2;

  const bg = fc.bg;

  if (combined > 0.5) {
    // Warp thread (vertical emphasis) — prototype opacity: 0.3 + combined * 0.5
    const char = WARP[Math.floor((tick * 0.02 + sr) % WARP.length)] ?? '│';
    const color = fc.palette[Math.floor((sr + tick * 0.01) % fc.palette.length)] ?? '#89b4fa';
    // Higher combined = brighter
    return combined > 0.7
      ? chalk.bgHex(bg).hex(color)(char)
      : chalk.bgHex(bg).hex(color).dim(char);
  }

  if (combined > 0.0) {
    // Weft thread (horizontal emphasis) — prototype opacity: 0.2 + combined * 0.6
    const char = WEFT[Math.floor((tick * 0.02 + sc) % WEFT.length)] ?? '─';
    const color = fc.palette[Math.floor((sc + tick * 0.015) % fc.palette.length)] ?? '#cba6f7';
    return combined > 0.3
      ? chalk.bgHex(bg).hex(color).dim(char)
      : chalk.bgHex(bg).hex(color).dim(char);
  }

  if (combined > -0.3) {
    // Cross points — prototype: isCross when (r+c+tick*0.01)%7===0
    const isCross = (Math.floor(sr) + Math.floor(sc) + Math.floor(tick * 0.01)) % 7 === 0;
    if (isCross) {
      const ci = pseudoRand(r, c, tick) % CROSS.length;
      const char = CROSS[ci] ?? '◇';
      const color = fc.palette[pseudoRand(r, c, tick + 1) % fc.palette.length] ?? '#94e2d5';
      return chalk.bgHex(bg).hex(color).dim(char);
    }
    // Faint dot — prototype opacity: 0.2
    return chalk.bgHex(bg).hex(fc.surface1).dim('·');
  }

  // Dark zone — prototype: dot at opacity 0.15
  return chalk.bgHex(bg).hex(fc.surface0).dim('·');
}

function buildFrame(
  cols: number, rows: number, tick: number,
  dissolveProgress: number, fc: FC,
): string[] {
  const lines: string[] = [];

  // Scale factors to map terminal dimensions to prototype's 50×22
  const colScale = PROTO_COLS / cols;
  const rowScale = PROTO_ROWS / rows;

  // Logo dimensions
  const logoLine = '◈ openweft';
  const hintParts = [
    { t: 'Press ', c: fc.subtext, bg: '' },
    { t: ' a ', c: fc.blue, bg: fc.surface0 },
    { t: ' to add a feature  ·  ', c: fc.subtext, bg: '' },
    { t: ' s ', c: fc.blue, bg: fc.surface0 },
    { t: ' to start', c: fc.subtext, bg: '' },
  ];
  const hintLen = hintParts.reduce((sum, p) => sum + p.t.length, 0);
  const logoW = Math.max(logoLine.length, hintLen) + 6;
  const logoH = 4;
  const cxStart = Math.floor((cols - logoW) / 2);
  const cxEnd = cxStart + logoW;
  const cyStart = Math.floor((rows - logoH) / 2);
  const cyEnd = cyStart + logoH;

  const centerR = rows / 2;
  const centerC = cols / 2;
  const maxDist = Math.sqrt(centerR * centerR + centerC * centerC);
  const showLogo = dissolveProgress < 0.3;
  const bgChar = chalk.bgHex(fc.bg)(' ');

  for (let r = 0; r < rows; r++) {
    const isLogoZone = r >= cyStart && r < cyEnd;
    const relRow = r - cyStart;

    // Logo content rows — build in 3 segments to avoid ANSI slicing
    if (isLogoZone && showLogo && (relRow === 1 || relRow === 2)) {
      const left = buildSeg(0, cxStart, r, tick, dissolveProgress, centerR, centerC, maxDist, colScale, rowScale, fc);
      const right = buildSeg(cxEnd, cols, r, tick, dissolveProgress, centerR, centerC, maxDist, colScale, rowScale, fc);

      if (relRow === 1) {
        const pad = Math.floor((logoW - logoLine.length) / 2);
        const logoStr = chalk.bgHex(fc.bg).hex(fc.textColor).bold(logoLine);
        const zone = bgChar.repeat(pad) + logoStr + bgChar.repeat(Math.max(0, logoW - pad - logoLine.length));
        lines.push(left + zone + right);
      } else {
        const pad = Math.floor((logoW - hintLen) / 2);
        let hintStr = bgChar.repeat(pad);
        for (const p of hintParts) {
          hintStr += p.bg
            ? chalk.bgHex(p.bg).hex(p.c).bold(p.t)
            : chalk.bgHex(fc.bg).hex(p.c)(p.t);
        }
        hintStr += bgChar.repeat(Math.max(0, logoW - pad - hintLen));
        lines.push(left + hintStr + right);
      }
      continue;
    }

    // Regular row
    let line = '';
    for (let c = 0; c < cols; c++) {
      if (dissolveProgress > 0) {
        const dist = Math.sqrt((r - centerR) ** 2 + (c - centerC) ** 2);
        if (dist / maxDist < dissolveProgress * 1.3) {
          line += bgChar;
          continue;
        }
      }
      if (isLogoZone && c >= cxStart && c < cxEnd) {
        line += bgChar;
        continue;
      }
      line += loomChar(r, c, tick, colScale, rowScale, fc);
    }
    lines.push(line);
  }

  return lines;
}

function buildSeg(
  colStart: number, colEnd: number, r: number, tick: number,
  dissolveProgress: number, centerR: number, centerC: number, maxDist: number,
  colScale: number, rowScale: number, fc: FC,
): string {
  const bgChar = chalk.bgHex(fc.bg)(' ');
  let seg = '';
  for (let c = colStart; c < colEnd; c++) {
    if (dissolveProgress > 0) {
      const dist = Math.sqrt((r - centerR) ** 2 + (c - centerC) ** 2);
      if (dist / maxDist < dissolveProgress * 1.3) {
        seg += bgChar;
        continue;
      }
    }
    seg += loomChar(r, c, tick, colScale, rowScale, fc);
  }
  return seg;
}

export const EmptyState: React.FC<EmptyStateProps> = React.memo(({ dissolving, onDissolved }) => {
  const { colors } = useTheme();
  const { columns, rows: termRows } = useTerminalSize();

  const [tick, setTick] = useState(0);
  const [dissolveFrame, setDissolveFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), FRAME_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!dissolving) return;
    if (dissolveFrame >= DISSOLVE_FRAMES) {
      onDissolved?.();
      return;
    }
    const timer = setTimeout(() => setDissolveFrame((f) => f + 1), 40);
    return () => clearTimeout(timer);
  }, [dissolving, dissolveFrame, onDissolved]);

  const gridRows = Math.max(4, termRows - 2);
  const gridCols = Math.max(20, columns);
  const dissolveProgress = dissolving ? dissolveFrame / DISSOLVE_FRAMES : 0;

  const fc: FC = {
    palette: [colors.mauve, colors.blue, colors.teal, colors.peach, '#f5c2e7', colors.lavender, colors.sky, colors.green],
    bg: colors.bg,          // #1e1e2e — Catppuccin Mocha base
    surface0: colors.surface0,
    surface1: '#45475a',
    textColor: colors.text,
    subtext: colors.subtext,
    blue: colors.blue,
  };

  const frame = buildFrame(gridCols, gridRows, tick, dissolveProgress, fc);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {frame.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
});

EmptyState.displayName = 'EmptyState';
