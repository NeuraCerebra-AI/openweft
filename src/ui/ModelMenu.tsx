import React from 'react';
import { Box, Text } from 'ink';

import {
  getEffortOptionsForBackend,
  getModelOptionsForBackend
} from '../config/options.js';
import type { UserBackend } from '../domain/primitives.js';
import type { ModelMenuState } from './store.js';
import { useTheme } from './theme.js';

export interface ModelMenuProps {
  readonly backend: UserBackend;
  readonly menu: ModelMenuState;
}

const renderInlineOptions = (
  options: readonly string[],
  selected: string,
  focused: boolean,
  accentColor: string,
  mutedColor: string
): React.ReactNode => {
  return options.map((option, index) => (
    <React.Fragment key={option}>
      {index > 0 && <Text color={mutedColor}>{' · '}</Text>}
      <Text color={option === selected ? accentColor : mutedColor}>
        {option === selected ? `[${option}]` : option}
      </Text>
    </React.Fragment>
  ));
};

export const ModelMenu: React.FC<ModelMenuProps> = React.memo(({ backend, menu }) => {
  const { colors, borders } = useTheme();
  const modelOptions = getModelOptionsForBackend(backend, menu.model);
  const effortOptions = getEffortOptionsForBackend(backend);

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle={borders.prompt} borderColor={colors.green} padding={1}>
      <Text bold color={colors.green}>{'Model + Effort'}</Text>
      <Text color={colors.subtext}>{`Backend: ${backend}`}</Text>
      <Text color={colors.muted}>{'Use up/down to move, left/right to adjust, Enter to save, Esc to cancel.'}</Text>
      <Text>{''}</Text>

      <Box flexDirection="column">
        <Text color={menu.focus === 'model' ? colors.blue : colors.subtext}>
          {menu.focus === 'model' ? '› ' : '  '}
          <Text bold>{'Model'}</Text>
          <Text>{`: ${menu.model}`}</Text>
        </Text>
        <Text color={colors.subtext}>
          {'  '}
          {renderInlineOptions(
            modelOptions,
            menu.model,
            menu.focus === 'model',
            colors.blue,
            colors.subtext
          )}
        </Text>
      </Box>

      <Text>{''}</Text>

      <Box flexDirection="column">
        <Text color={menu.focus === 'effort' ? colors.peach : colors.subtext}>
          {menu.focus === 'effort' ? '› ' : '  '}
          <Text bold>{'Effort'}</Text>
          <Text>{`: ${menu.effort}`}</Text>
        </Text>
        <Text color={colors.subtext}>
          {'  '}
          {renderInlineOptions(
            effortOptions,
            menu.effort,
            menu.focus === 'effort',
            colors.peach,
            colors.subtext
          )}
        </Text>
      </Box>

      <Text>{''}</Text>

      <Text>
        <Text color={menu.focus === 'save' ? colors.green : colors.subtext}>
          {menu.focus === 'save' ? '[Enter save]' : 'Enter save'}
        </Text>
        <Text color={colors.muted}>{' · '}</Text>
        <Text color={menu.focus === 'cancel' ? colors.red : colors.subtext}>
          {menu.focus === 'cancel' ? '[Esc cancel]' : 'Esc cancel'}
        </Text>
      </Text>
    </Box>
  );
});

ModelMenu.displayName = 'ModelMenu';
