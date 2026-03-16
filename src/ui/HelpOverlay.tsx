import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';

export const HelpOverlay: React.FC = React.memo(() => {
  const { colors, borders } = useTheme();

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle={borders.prompt} borderColor={colors.blue} padding={1}>
      <Text bold color={colors.blue}>{'Keyboard Shortcuts'}</Text>
      <Text>{''}</Text>
      <Text><Text bold>{'Tab'}</Text><Text color={colors.subtext}>{'     Switch panel'}</Text></Text>
      <Text><Text bold>{'↑/↓'}</Text><Text color={colors.subtext}>{'     Navigate / Scroll'}</Text></Text>
      <Text><Text bold>{'Enter'}</Text><Text color={colors.subtext}>{'   Focus agent'}</Text></Text>
      <Text><Text bold>{'/'}</Text><Text color={colors.subtext}>{'       Filter agents'}</Text></Text>
      <Text><Text bold>{'q'}</Text><Text color={colors.subtext}>{'       Quit'}</Text></Text>
      <Text><Text bold>{'?'}</Text><Text color={colors.subtext}>{'       Toggle this help'}</Text></Text>
      <Text><Text bold>{'s'}</Text><Text color={colors.subtext}>{'       Start execution'}</Text></Text>
      <Text><Text bold>{'d'}</Text><Text color={colors.subtext}>{'       Remove from queue'}</Text></Text>
      <Text><Text bold>{'a'}</Text><Text color={colors.subtext}>{'       Add to queue'}</Text></Text>
      <Text>{''}</Text>
      <Text color={colors.muted}>{'Press ? or Esc to dismiss'}</Text>
    </Box>
  );
});

HelpOverlay.displayName = 'HelpOverlay';
