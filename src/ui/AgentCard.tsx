import React from 'react';
import { Box, Text } from 'ink';

import type { AgentStatus } from './store.js';
import type { ApprovalRequest } from './events.js';
import { formatTime, getStatusIcon } from './utils.js';
import type { ThemeColors } from './theme.js';
import { useTheme } from './theme.js';

export interface AgentCardProps {
  readonly name: string;
  readonly feature: string;
  readonly status: AgentStatus;
  readonly focused: boolean;
  readonly files: readonly string[];
  readonly tokens: number;
  readonly cost: number;
  readonly elapsed: number;
  readonly currentTool: string | null;
  readonly approvalRequest: ApprovalRequest | null;
  readonly spinnerFrame: number;
  readonly readyStateDetail: string | null;
}

const formatTokens = (tokens: number): string =>
  tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);

const statusBorderColor = (status: AgentStatus, focused: boolean, colors: ThemeColors): string => {
  if (focused) return colors.blue;
  switch (status) {
    case 'running': return colors.green;
    case 'completed': return colors.green;
    case 'failed': return colors.red;
    case 'queued': return colors.surface2;
    case 'approval': return colors.yellow;
  }
};

export const AgentCard: React.FC<AgentCardProps> = React.memo(({
  name,
  feature,
  status,
  focused,
  files,
  tokens,
  cost,
  elapsed,
  currentTool,
  approvalRequest,
  spinnerFrame,
  readyStateDetail,
}) => {
  const { colors, borders } = useTheme();
  const { icon, colorKey } = getStatusIcon(status, spinnerFrame);
  const borderColor = statusBorderColor(status, focused, colors);
  const dim = status === 'completed' && !focused;
  const showSecondaryFeature = feature !== name;

  return (
    <Box
      flexDirection="column"
      borderStyle={focused ? borders.panelActive : borders.panel}
      borderColor={borderColor}
      paddingX={1}
    >
      {/* Top row */}
      <Box>
        <Text color={colors[colorKey]} dimColor={dim}>{icon} </Text>
        <Box flexGrow={1}>
          <Text bold={focused} dimColor={dim} wrap="truncate-end">{name}</Text>
        </Box>
        <Box flexGrow={1} />
        {files.length > 0 && <Text color={colors.green} dimColor={dim}>{` ${files.length} files `}</Text>}
        {tokens > 0 && <Text color={colors.peach} dimColor={dim}>{` ${formatTokens(tokens)} tok `}</Text>}
        <Text color={colors.muted} dimColor={dim}>{formatTime(elapsed)}</Text>
      </Box>

      {/* Detail section */}
      <Box flexDirection="column" paddingLeft={2}>
        {showSecondaryFeature && (
          <Text color={colors.subtext} dimColor={dim} wrap="truncate-end">{feature}</Text>
        )}
        {focused && files.length > 0 && (
          <Box>
            <Text color={colors.green}>{'files: '}</Text>
            <Text color={colors.muted} wrap="truncate-end">{files.join(', ')}</Text>
          </Box>
        )}
        {currentTool !== null && <Text color={colors.mauve} dimColor={dim} wrap="truncate-end">{`▸ ${currentTool}`}</Text>}
        {focused && readyStateDetail !== null && <Text color={colors.teal} wrap="truncate-end">{readyStateDetail}</Text>}
        {focused && approvalRequest !== null && (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={colors.yellow}
            paddingX={1}
            marginTop={1}
          >
            <Text bold color={colors.yellow}>APPROVAL NEEDED</Text>
            <Text color={colors.text}>{`${approvalRequest.action}: ${approvalRequest.file}`}</Text>
            <Text color={colors.subtext}>{approvalRequest.detail}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
});

AgentCard.displayName = 'AgentCard';
