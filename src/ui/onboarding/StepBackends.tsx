import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

import {
  getDefaultEffortForBackend,
  getDefaultModelForBackend,
  getEffortOptionsForBackend,
  getModelOptionsForBackend,
  type BackendEffortLevel
} from '../../config/options.js';
import { useTheme } from '../theme.js';
import { SelectInput } from './SelectInput.js';
import { WizardFooter } from './WizardFooter.js';
import { WizardHeader } from './WizardHeader.js';
import type { BackendDetection, OnboardingAuthMode } from './types.js';

export interface StepBackendsProps {
  readonly codexStatus: BackendDetection;
  readonly claudeStatus: BackendDetection;
  readonly onAdvance: (selection: {
    backend: 'codex' | 'claude';
    authMode: OnboardingAuthMode;
    model: string;
    effort: BackendEffortLevel;
  }) => void;
  readonly onBack: () => void;
  readonly onExit: () => void;
  readonly onRedetectBackends: () => Promise<{ codex: BackendDetection; claude: BackendDetection }>;
}

const BACKEND_OPTIONS = [
  { label: 'Codex', value: 'codex' as const },
  { label: 'Claude', value: 'claude' as const },
] as const;

const AUTH_MODE_OPTIONS = [
  { label: 'Subscription login', value: 'subscription' as const },
  { label: 'API key environment variable', value: 'api_key' as const },
] as const;

type BackendOptionValue = 'codex' | 'claude';
type SelectionPhase = 'backend' | 'auth' | 'model' | 'effort';

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

type ViewMode = 'select' | 'auto-select' | 'error-not-installed';

function deriveViewMode(codex: BackendDetection, claude: BackendDetection): ViewMode {
  const codexReady = codex.installed;
  const claudeReady = claude.installed;
  if (codexReady && claudeReady) return 'select';
  if (codexReady || claudeReady) return 'auto-select';
  return 'error-not-installed';
}

function deriveAutoSelected(
  codex: BackendDetection,
  claude: BackendDetection,
): 'codex' | 'claude' | null {
  if (codex.installed) return 'codex';
  if (claude.installed) return 'claude';
  return null;
}

export const StepBackends: React.FC<StepBackendsProps> = ({
  codexStatus,
  claudeStatus,
  onAdvance,
  onBack,
  onExit,
  onRedetectBackends,
}) => {
  const { colors } = useTheme();

  // Local state that gets updated after redetection
  const [localCodex, setLocalCodex] = useState<BackendDetection>(codexStatus);
  const [localClaude, setLocalClaude] = useState<BackendDetection>(claudeStatus);
  const [isRedetecting, setIsRedetecting] = useState(false);
  const [selectionPhase, setSelectionPhase] = useState<SelectionPhase>('backend');
  const [draftBackend, setDraftBackend] = useState<BackendOptionValue | null>(null);
  const [draftAuthMode, setDraftAuthMode] = useState<OnboardingAuthMode>('subscription');
  const [draftModel, setDraftModel] = useState<string | null>(null);

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

  const beginSelection = (backend: BackendOptionValue): void => {
    setDraftBackend(backend);
    setDraftAuthMode('subscription');
    setDraftModel(getDefaultModelForBackend(backend));
    setSelectionPhase('auth');
  };

  const selectedBackend = draftBackend ?? autoSelected;
  const selectedModel =
    selectedBackend === null
      ? null
      : draftModel ?? getDefaultModelForBackend(selectedBackend);

  const completeSelection = (effort: BackendEffortLevel): void => {
    if (selectedBackend === null || selectedModel === null) {
      return;
    }

    onAdvance({
      backend: selectedBackend,
      authMode: draftAuthMode,
      model: selectedModel,
      effort
    });
  };

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

    if (key.leftArrow) {
      if (viewMode === 'error-not-installed') {
        return;
      }

      if (selectionPhase === 'backend') {
        onBack();
        return;
      }

      if (selectionPhase === 'auth') {
        setSelectionPhase('backend');
        setDraftBackend(null);
        setDraftModel(null);
        return;
      }

      if (selectionPhase === 'model') {
        setSelectionPhase('auth');
        return;
      }

      setSelectionPhase('model');
      return;
    }

    if (viewMode === 'auto-select' && selectionPhase === 'backend' && key.return && autoSelected !== null) {
      beginSelection(autoSelected);
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
    if (selectionPhase === 'auth' || selectionPhase === 'model' || selectionPhase === 'effort') {
      return ['select', 'confirm', 'retry', 'back', 'quit'] as const;
    }
    if (viewMode === 'select') {
      return ['select', 'confirm', 'retry', 'back', 'quit'] as const;
    }
    if (viewMode === 'auto-select') {
      return ['continue', 'retry', 'back', 'quit'] as const;
    }
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
      {viewMode === 'select' && selectionPhase === 'backend' && (
        <Box flexDirection="column" gap={1}>
          <Text color={colors.text}>{'Choose your default backend'}</Text>
          <SelectInput<BackendOptionValue>
            options={BACKEND_OPTIONS}
            onSelect={(value) => {
              beginSelection(value);
            }}
          />
        </Box>
      )}

      {viewMode === 'auto-select' && autoSelected !== null && selectionPhase === 'backend' && (
        <Box flexDirection="column" gap={0}>
          <Text color={colors.green}>{`Using ${autoSelected} as your default backend.`}</Text>
          <Text color={colors.subtext}>{'Press Enter to choose auth, model, and effort.'}</Text>
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

      {selectedBackend !== null && selectionPhase === 'auth' && (
        <Box flexDirection="column" gap={1}>
          <Text color={colors.text}>{`Choose ${selectedBackend} auth mode`}</Text>
          <Text color={colors.subtext}>
            {selectedBackend === 'codex' && !localCodex.authenticated
              ? 'Subscription login currently needs codex login; API-key mode can use CODEX_API_KEY.'
              : selectedBackend === 'claude' && !localClaude.authenticated
                ? 'Subscription login currently needs claude auth login; API-key mode can use ANTHROPIC_API_KEY.'
                : 'Subscription login is the default; API-key mode is optional.'}
          </Text>
          <SelectInput<OnboardingAuthMode>
            options={AUTH_MODE_OPTIONS.map((option) => ({
              label: option.value === 'subscription'
                ? `${option.label} (default)`
                : option.label,
              value: option.value
            }))}
            onSelect={(value) => {
              setDraftAuthMode(value);
              setSelectionPhase('model');
            }}
          />
        </Box>
      )}

      {selectedBackend !== null && selectedModel !== null && selectionPhase === 'model' && (
        <Box flexDirection="column" gap={1}>
          <Text color={colors.text}>{`Choose the default ${selectedBackend} model`}</Text>
          <SelectInput<string>
            options={getModelOptionsForBackend(selectedBackend, selectedModel).map((model) => ({
              label: model,
              value: model
            }))}
            onSelect={(value) => {
              setDraftModel(value);
              setSelectionPhase('effort');
            }}
          />
        </Box>
      )}

      {selectedBackend !== null && selectedModel !== null && selectionPhase === 'effort' && (
        <Box flexDirection="column" gap={1}>
          <Text color={colors.text}>{`Choose the default ${selectedBackend} effort`}</Text>
          <Text color={colors.subtext}>{`Model: ${selectedModel}`}</Text>
          <SelectInput<BackendEffortLevel>
            options={getEffortOptionsForBackend(selectedBackend).map((effort) => ({
              label: effort,
              value: effort
            }))}
            initialIndex={getEffortOptionsForBackend(selectedBackend).indexOf(
              getDefaultEffortForBackend(selectedBackend)
            )}
            onSelect={(value) => {
              completeSelection(value);
            }}
          />
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
