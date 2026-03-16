import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';
import { AgentRow } from './AgentRow.js';
import { AgentExpanded } from './AgentExpanded.js';
import type { AgentState } from './store.js';

interface SidebarProps {
  readonly agents: AgentState[];
  readonly focusedAgentId: string | null;
  readonly phase: { current: number; total: number } | null;
  readonly totalCost: number;
  readonly isFocused: boolean;
  readonly addInputText: string | null;
}

export const Sidebar: React.FC<SidebarProps> = React.memo(({ agents, focusedAgentId, phase, totalCost, isFocused, addInputText }) => {
  const { colors, borders } = useTheme();

  return (
    <Box
      flexDirection="column"
      width={24}
      borderStyle={isFocused ? borders.panelActive : borders.panel}
      borderColor={isFocused ? colors.blue : colors.surface1}
    >
      {addInputText !== null ? (
        <Box borderStyle={borders.prompt} borderColor={colors.green} paddingLeft={1} paddingRight={1}>
          <Text color={colors.green}>{'> '}</Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate">{addInputText}</Text>
          </Box>
          <Text color={colors.muted}>{'█'}</Text>
        </Box>
      ) : null}
      {agents.map((agent) => {
        const focused = agent.id === focusedAgentId;
        return (
          <Box key={agent.id} flexDirection="column">
            <AgentRow name={agent.name} status={agent.status} elapsed={agent.elapsed} focused={focused} />
            {focused && (
              <AgentExpanded
                name={agent.name}
                feature={agent.feature}
                currentTool={agent.currentTool}
                cost={agent.cost}
                elapsed={agent.elapsed}
              />
            )}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color={colors.muted}>
          {phase !== null ? `Phase ${phase.current}/${phase.total}` : 'Idle'}
          {totalCost > 0 ? ` · $${totalCost.toFixed(2)}` : ''}
        </Text>
      </Box>
    </Box>
  );
});

Sidebar.displayName = 'Sidebar';
