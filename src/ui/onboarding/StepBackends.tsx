import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from '../theme.js';
import { SelectInput } from './SelectInput.js';
import { WizardFooter } from './WizardFooter.js';
import { WizardHeader } from './WizardHeader.js';
import type { BackendDetection } from './types.js';

export interface StepBackendsProps {
  readonly codexStatus: BackendDetection;
  readonly claudeStatus: BackendDetection;
  readonly onAdvance: (selectedBackend: 'codex' | 'claude') => void;
  readonly onExit: () => void;
  readonly onRedetectBackends: () => Promise<{ codex: BackendDetection; claude: BackendDetection }>;
}

const BACKEND_OPTIONS = [
  { label: 'Codex', value: 'codex' as const },
  { label: 'Claude', value: 'claude' as const },
] as const;

type BackendOptionValue = 'codex' | 'claude';

// Determine the display icon and its meaning for a BackendDetection
function getStatusIcon(status: BackendDetection): {
  icon: '✓' | '!' | '✗';
  meaning: 'authed' | 'needs-auth' | 'not-installed';
} {
  if (!status.installed) {
    return { icon: '✗', meaning: 'not-installed' };
  }
  if (!status.authenticated) {
    return { icon: '!', meaning: 'needs-auth' };
  }
  return { icon: '✓', meaning: 'authed' };
}

type ViewMode = 'select' | 'auto-select' | 'error-no-auth' | 'error-not-installed';

function deriveViewMode(codex: BackendDetection, claude: BackendDetection): ViewMode {
  const codexReady = codex.installed && codex.authenticated;
  const claudeReady = claude.installed && claude.authenticated;
  const eitherInstalled = codex.installed || claude.installed;

  if (codexReady && claudeReady) return 'select';
  if (codexReady || claudeReady) return 'auto-select';
  if (eitherInstalled) return 'error-no-auth';
  return 'error-not-installed';
}

function deriveAutoSelected(
  codex: BackendDetection,
  claude: BackendDetection,
): 'codex' | 'claude' | null {
  if (codex.installed && codex.authenticated) return 'codex';
  if (claude.installed && claude.authenticated) return 'claude';
  return null;
}

export const StepBackends: React.FC<StepBackendsProps> = ({
  codexStatus,
  claudeStatus,
  onAdvance,
  onExit,
  onRedetectBackends,
}) => {
  const { colors } = useTheme();

  // Local state that gets updated after redetection
  const [localCodex, setLocalCodex] = useState<BackendDetection>(codexStatus);
  const [localClaude, setLocalClaude] = useState<BackendDetection>(claudeStatus);
  const [isRedetecting, setIsRedetecting] = useState(false);

  const redetectBackends = async (): Promise<void> => {
    if (isRedetecting) {
      return;
    }

    setIsRedetecting(true);
    try {
      const { codex, claude } = await onRedetectBackends();
      setLocalCodex(codex);
      setLocalClaude(claude);
    } finally {
      setIsRedetecting(false);
    }
  };

  // On mount, re-run detection to pick up any auth changes since the prop was set
  useEffect(() => {
    void redetectBackends();
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const viewMode = deriveViewMode(localCodex, localClaude);
  const autoSelected = deriveAutoSelected(localCodex, localClaude);

  // Handle Esc (quit) in error states and auto-select mode
  // In select mode, Esc is handled here too; Enter in auto-select mode handled below
  useInput((_input, key) => {
    if (key.escape) {
      onExit();
      return;
    }

    if (_input.toLowerCase() === 'r') {
      void redetectBackends();
      return;
    }

    if (viewMode === 'auto-select' && key.return && autoSelected !== null) {
      onAdvance(autoSelected);
    }
  });

  const codexIcon = getStatusIcon(localCodex);
  const claudeIcon = getStatusIcon(localClaude);

  const iconColor = (icon: '✓' | '!' | '✗'): string => {
    if (icon === '✓') return colors.green;
    if (icon === '!') return colors.yellow;
    return colors.red;
  };

  // Render backend status rows
  const renderStatusRow = (
    name: string,
    detection: BackendDetection,
    icon: ReturnType<typeof getStatusIcon>,
  ) => (
    <Box key={name} flexDirection="row" gap={1}>
      <Text color={iconColor(icon.icon)}>{icon.icon}</Text>
      <Text color={colors.text}>{name}</Text>
      {icon.meaning === 'needs-auth' && (
        <Text color={colors.subtext}>{'(installed, needs auth)'}</Text>
      )}
      {icon.meaning === 'not-installed' && (
        <Text color={colors.subtext}>{'(not installed)'}</Text>
      )}
      {icon.meaning === 'authed' && detection.authenticated && (
        <Text color={colors.subtext}>{'(ready)'}</Text>
      )}
    </Box>
  );

  // Determine footer keys
  const footerKeys = (() => {
    if (viewMode === 'select') {
      return ['select', 'confirm', 'retry', 'back', 'quit'] as const;
    }
    if (viewMode === 'auto-select') {
      return ['continue', 'retry', 'back', 'quit'] as const;
    }
    // error states
    return ['retry', 'quit'] as const;
  })();

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      {/* Brand header */}
      <WizardHeader subtitle="setup · backends" />

      {/* Backend status rows */}
      <Box flexDirection="column" gap={0}>
        {renderStatusRow('codex', localCodex, codexIcon)}
        {renderStatusRow('claude', localClaude, claudeIcon)}
      </Box>

      {isRedetecting && (
        <Text color={colors.subtext}>{'Rechecking backend detection...'}</Text>
      )}

      {/* Content area based on view mode */}
      {viewMode === 'select' && (
        <Box flexDirection="column" gap={1}>
          <Text color={colors.text}>{'Choose your default backend'}</Text>
          <SelectInput<BackendOptionValue>
            options={BACKEND_OPTIONS}
            onSelect={(value) => {
              onAdvance(value);
            }}
          />
        </Box>
      )}

      {viewMode === 'auto-select' && autoSelected !== null && (
        <Box flexDirection="column" gap={0}>
          <Text color={colors.green}>{`Using ${autoSelected} as your default backend.`}</Text>
          {localCodex.installed && !localCodex.authenticated && (
            <Text color={colors.subtext}>
              {'codex is installed but needs auth: run '}
              <Text color={colors.yellow}>{'codex login'}</Text>
            </Text>
          )}
          {localClaude.installed && !localClaude.authenticated && (
            <Text color={colors.subtext}>
              {'claude is installed but needs auth: run '}
              <Text color={colors.yellow}>{'claude auth login'}</Text>
            </Text>
          )}
        </Box>
      )}

      {viewMode === 'error-no-auth' && (
        <Box flexDirection="column" gap={1}>
          <Text color={colors.yellow} bold>
            {'No backends authenticated'}
          </Text>
          <Box flexDirection="column" gap={0}>
            {localCodex.installed && !localCodex.authenticated && (
              <Text color={colors.subtext}>
                {'codex: run '}
                <Text color={colors.peach}>{'codex login'}</Text>
              </Text>
            )}
            {localClaude.installed && !localClaude.authenticated && (
              <Text color={colors.subtext}>
                {'claude: run '}
                <Text color={colors.peach}>{'claude auth login'}</Text>
              </Text>
            )}
          </Box>
          <Text color={colors.subtext}>
            {'Press '}
            <Text color={colors.text}>{'R'}</Text>
            {' to retry after authenticating a backend.'}
          </Text>
        </Box>
      )}

      {viewMode === 'error-not-installed' && (
        <Box flexDirection="column" gap={1}>
          <Text color={colors.red} bold>
            {'No backends available'}
          </Text>
          <Box flexDirection="column" gap={0}>
            <Text color={colors.subtext}>
              {'Install codex: '}
              <Text color={colors.peach}>{'npm install -g @openai/codex'}</Text>
            </Text>
            <Text color={colors.subtext}>
              {'Install claude: '}
              <Text color={colors.peach}>{'npm install -g @anthropic-ai/claude-code'}</Text>
            </Text>
          </Box>
          <Text color={colors.subtext}>
            {'Press '}
            <Text color={colors.text}>{'R'}</Text>
            {' to retry after installing a backend.'}
          </Text>
        </Box>
      )}

      {/* Footer */}
      <WizardFooter keys={footerKeys} />
    </Box>
  );
};

StepBackends.displayName = 'StepBackends';
