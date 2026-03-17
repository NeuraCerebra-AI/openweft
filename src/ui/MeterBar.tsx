import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';
import { formatTime } from './utils.js';

export interface MeterBarProps {
  readonly phase: { current: number; total: number } | null;
  readonly completedCount: number;
  readonly totalAgentCount: number;
  readonly totalTokens: number;
  readonly elapsed: number;
}

const BAR_WIDTH = 20;
const FILLED_CHAR = '\u2501'; // ━
const TOKEN_CAP = 200_000;
const TIME_CAP = 600;

interface MeterProps {
  readonly label: string;
  readonly value: string;
  readonly percent: number;
  readonly color: string;
}

const Meter: React.FC<MeterProps> = ({ label, value, percent, color }) => {
  const { colors } = useTheme();
  const clamped = Math.min(Math.max(percent, 0), 100);
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Text color={colors.muted}>{label}</Text>
        <Text color={colors.subtext}>{value}</Text>
      </Box>
      <Text>
        <Text color={color}>{FILLED_CHAR.repeat(filled)}</Text>
        <Text color={colors.surface0}>{FILLED_CHAR.repeat(empty)}</Text>
      </Text>
    </Box>
  );
};

export const MeterBar: React.FC<MeterBarProps> = React.memo(
  ({ phase, completedCount, totalAgentCount, totalTokens, elapsed }) => {
    const { colors } = useTheme();

    if (phase === null) {
      return null;
    }

    const phasePercent =
      totalAgentCount > 0 ? (completedCount / totalAgentCount) * 100 : 0;

    const tokenValue =
      totalTokens >= 1000
        ? `${Math.floor(totalTokens / 1000)}k`
        : String(totalTokens);
    const tokenPercent = Math.min((totalTokens / TOKEN_CAP) * 100, 100);

    const timePercent = Math.min((elapsed / TIME_CAP) * 100, 100);

    return (
      <Box flexDirection="row" gap={2}>
        <Meter
          label={`Phase ${phase.current}/${phase.total}`}
          value={`${completedCount}/${totalAgentCount}`}
          percent={phasePercent}
          color={colors.blue}
        />
        <Meter
          label="Tokens"
          value={tokenValue}
          percent={tokenPercent}
          color={colors.peach}
        />
        <Meter
          label="Time"
          value={formatTime(elapsed)}
          percent={timePercent}
          color={colors.green}
        />
      </Box>
    );
  }
);

MeterBar.displayName = 'MeterBar';
