import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from '../theme.js';
import { SelectInput } from './SelectInput.js';
import { WizardFooter } from './WizardFooter.js';
import { WizardHeader } from './WizardHeader.js';

export interface StepSuperpowersProps {
  readonly selectedBackend: 'codex' | 'claude';
  readonly onAdvance: () => void;
  readonly onBack: () => void;
  readonly onExit: () => void;
  readonly onOpenRepo: () => Promise<void>;
}

type SuperpowersAction = 'skip' | 'open-repo';

const SUPERPOWERS_REPO_URL = 'github.com/obra/superpowers';
const SUPERPOWERS_CONTENT = {
  codex: {
    supportLine: 'Codex supports it through native skill discovery.',
    installLine: 'It installs in your local Codex setup, not this repo.',
    nextStepLine: 'After installing, restart Codex, then start OpenWeft again.',
    actionLabel: 'Open Codex install guide',
  },
  claude: {
    supportLine: 'Claude supports it through the plugin marketplace.',
    installLine: 'It installs in your local Claude setup, not this repo.',
    nextStepLine: 'After installing, start a new OpenWeft/Claude session.',
    actionLabel: 'Open Superpowers install guide',
  },
} as const;

export const StepSuperpowers: React.FC<StepSuperpowersProps> = ({
  selectedBackend,
  onAdvance,
  onBack,
  onExit,
  onOpenRepo,
}) => {
  const { colors } = useTheme();
  const content = SUPERPOWERS_CONTENT[selectedBackend];
  const [status, setStatus] = useState<{ level: 'info' | 'error'; message: string } | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [selectorKey, setSelectorKey] = useState(0);

  useInput((_input, key) => {
    if (key.leftArrow) {
      onBack();
      return;
    }

    if (key.escape) {
      onExit();
    }
  });

  const openRepo = async (): Promise<void> => {
    if (isOpening) {
      return;
    }

    setIsOpening(true);
    setStatus({
      level: 'info',
      message: 'Opening the GitHub repo in your browser...'
    });

    try {
      await onOpenRepo();
      setStatus({
        level: 'info',
        message: 'Opened the install guide in your browser. Press Enter to skip or open it again.'
      });
    } catch {
      setStatus({
        level: 'error',
        message: 'Could not open a browser automatically. Visit github.com/obra/superpowers manually.'
      });
    } finally {
      setIsOpening(false);
      setSelectorKey((current) => current + 1);
    }
  };

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <WizardHeader subtitle="setup · optional" />

      <Text color={colors.lavender} bold>
        {'Optional: Superpowers'}
      </Text>

      <Box flexDirection="column" gap={0}>
        <Text color={colors.text}>{'Popular workflow toolkit for Claude and Codex, by Jesse Vincent.'}</Text>
        <Text color={colors.subtext}>{content.supportLine}</Text>
        <Text color={colors.subtext}>
          {content.installLine}
        </Text>
        <Text color={colors.subtext}>{'OpenWeft works without it. Skip is the default.'}</Text>
        <Text color={colors.subtext}>{content.nextStepLine}</Text>
        <Text color={colors.muted}>
          {`GitHub: ${SUPERPOWERS_REPO_URL} · If you already have it, ignore this note.`}
        </Text>
      </Box>

      {status !== null && (
        <Text color={status.level === 'error' ? colors.red : colors.yellow}>
          {status.message}
        </Text>
      )}

      <SelectInput<SuperpowersAction>
        key={selectorKey}
        options={[
          { label: 'Skip — continue setup', value: 'skip' },
          { label: content.actionLabel, value: 'open-repo' }
        ]}
        onSelect={(value) => {
          if (value === 'skip') {
            onAdvance();
            return;
          }

          void openRepo();
        }}
      />

      <WizardFooter keys={['select', 'confirm', 'back', 'quit']} />
    </Box>
  );
};

StepSuperpowers.displayName = 'StepSuperpowers';
