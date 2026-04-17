import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { useStore } from 'zustand/react';
import type { StoreApi } from 'zustand/vanilla';

import type { BackendEffortLevel } from '../config/options.js';
import { ThemeContext, catppuccinMocha } from './theme.js';
import { StatusBar } from './StatusBar.js';
import { MeterBar } from './MeterBar.js';
import { AgentCard } from './AgentCard.js';
import { HelpOverlay } from './HelpOverlay.js';
import { EmptyState } from './EmptyState.js';
import { Footer } from './Footer.js';
import { HistoryView } from './HistoryView.js';
import { HistoryDetailView } from './HistoryDetailView.js';
import { ModelMenu } from './ModelMenu.js';
import { TextInputField } from './TextInputField.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { filterAgents, handleKeypress } from './hooks/useKeyboard.js';
import type { UIStore } from './store.js';

interface AppProps {
  readonly store: StoreApi<UIStore>;
  readonly onQuitRequest?: (reason: 'keyboard') => void;
  readonly onApprovalDecision?: (decision: 'approve' | 'deny' | 'skip' | 'always') => void;
  readonly onStartRequest?: () => void;
  readonly onRemoveAgent?: (agentId: string) => void;
  readonly onAddRequest?: (request: string) => void;
  readonly onSaveModelSelection?: (selection: { model: string; effort: BackendEffortLevel }) => void;
}

const NOTICE_AUTO_CLEAR_MS = 5000;

export const App: React.FC<AppProps> = ({
  store,
  onQuitRequest,
  onApprovalDecision,
  onStartRequest,
  onRemoveAgent,
  onAddRequest,
  onSaveModelSelection
}) => {
  const state = useStore(store);
  const { exit } = useApp();
  const { rows } = useTerminalSize();

  // Empty-state dissolve transition: triggered by S or A, hides loom after animation
  const [loomDismissed, setLoomDismissed] = useState(false);
  const [loomDissolving, setLoomDissolving] = useState(false);
  const handleLoomDissolved = useCallback(() => {
    setLoomDismissed(true);
    setLoomDissolving(false);
  }, []);

  const filteredAgents = filterAgents(state.agents, state.filterText);
  const activeCount = state.agents.filter((a) => a.status === 'running' || a.status === 'approval').length;
  const pendingCount = state.agents.filter((a) => a.status === 'queued').length;
  const completedCount = state.agents.filter((a) => a.status === 'completed').length;
  const statusModelSelection = state.modelSelection === null
    ? null
    : {
        backend: state.modelSelection.backend,
        model: state.modelSelection.model,
        effort: state.modelSelection.effort
      };
  const canEditModelSelection = state.modelSelection?.editable === true && !state.executionRequested;

  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!state.executionRequested) return;
    if (startTimeRef.current === null) startTimeRef.current = Date.now();
    const origin = startTimeRef.current;
    const timer = setInterval(() => {
      const currentState = store.getState();
      currentState.setElapsed(Math.floor((Date.now() - origin) / 1000));
      currentState.tickAgentElapsed();
      currentState.tickSpinnerFrame();
    }, 1000);
    return () => clearInterval(timer);
  }, [store, state.executionRequested]);

  useEffect(() => {
    const focusVisible = filteredAgents.some((agent) => agent.id === state.focusedAgentId);
    if (!focusVisible) {
      const nextFocusedId = filteredAgents[0]?.id ?? null;
      if (nextFocusedId !== state.focusedAgentId) {
        store.getState().setFocusedAgent(nextFocusedId);
      }
    }
  }, [filteredAgents, state.focusedAgentId, store]);

  useEffect(() => {
    if (state.notice === null) {
      return;
    }

    const activeNotice = state.notice;
    const timer = setTimeout(() => {
      const currentState = store.getState();
      if (currentState.notice !== activeNotice) {
        return;
      }
      currentState.setNotice(null);
      if (currentState.quitConfirmPending) {
        currentState.setQuitConfirmPending(false);
      }
    }, NOTICE_AUTO_CLEAR_MS);

    return () => clearTimeout(timer);
  }, [state.notice, store]);

  // Determine if loom should show (no agents, not yet dismissed or dissolving)
  const showLoom = filteredAgents.length === 0 && !loomDismissed && !state.executionRequested;

  useInput((_input, key) => {
    // When loom is visible and user presses s or a, trigger dissolve first
    if (showLoom && !loomDissolving && (_input === 's' || _input === 'a')) {
      setLoomDissolving(true);
      const pressedKey = _input;
      // Defer the actual action until after dissolve animation (~480ms)
      setTimeout(() => {
        if (pressedKey === 's') {
          handleKeypress(store, 's', {
            ...(onStartRequest ? { onStartRequest } : {}),
          });
        } else {
          store.getState().setAddInputText('');
        }
      }, 500);
      return;
    }

    // Compose mode — swallow ALL keys
    const currentAddText = store.getState().addInputText;
    if (currentAddText !== null) {
      return;
    }

    const keyName = key.tab ? 'tab'
      : key.escape ? 'escape'
      : key.return ? 'return'
      : key.backspace ? 'backspace'
      : key.delete ? 'delete'
      : key.leftArrow ? 'left'
      : key.rightArrow ? 'right'
      : key.upArrow ? 'up'
      : key.downArrow ? 'down'
      : _input;

    const result = handleKeypress(store, keyName, {
      ...(onQuitRequest ? { onQuit: onQuitRequest } : {}),
      ...(onApprovalDecision ? { onApprovalDecision } : {}),
      ...(onStartRequest ? { onStartRequest } : {}),
      ...(onRemoveAgent ? { onRemoveAgent } : {}),
      ...(onSaveModelSelection ? { onSaveModelSelection } : {}),
    }, { meta: key.meta, ctrl: key.ctrl });
    if (result === 'quit') {
      exit();
    }
  });

  // History views take priority — accessible from dashboard or completion screen
  if (state.mode === 'history' || state.mode === 'history-detail') {
    const focusedFeature = state.completedFeatures[state.historyFocusedIndex];

    return (
      <ThemeContext.Provider value={catppuccinMocha}>
        <Box flexDirection="column" width="100%" height={rows}>
          <StatusBar
            phase={state.phase}
            activeCount={activeCount}
            pendingCount={0}
            totalCount={state.agents.length}
            totalTokens={state.totalTokens}
            elapsed={state.elapsed}
            modelSelection={statusModelSelection}
          />
          {state.showHelp ? (
            <HelpOverlay
              mode={state.mode}
              executionStarted={state.executionRequested}
              canEditModelSelection={canEditModelSelection}
            />
          ) : state.mode === 'history-detail' && focusedFeature ? (
            <HistoryDetailView feature={focusedFeature} />
          ) : (
            <HistoryView features={state.completedFeatures} focusedIndex={state.historyFocusedIndex} />
          )}
          <Footer
            mode={state.mode}
            executionStarted={state.executionRequested}
            composing={false}
            canEditModelSelection={canEditModelSelection}
          />
        </Box>
      </ThemeContext.Provider>
    );
  }

  if (state.completion !== null) {
    const completionPresentation = (() => {
      switch (state.completion.status) {
        case 'completed':
          return {
            label: 'Run complete',
            statusDetail: 'Status completed',
            color: catppuccinMocha.colors.green
          };
        case 'failed':
          return {
            label: 'Run failed',
            statusDetail: 'Status failed',
            color: catppuccinMocha.colors.red
          };
        case 'paused':
          return {
            label: 'Run paused',
            statusDetail: 'Status paused',
            color: catppuccinMocha.colors.yellow
          };
        case 'stopped':
          return {
            label: 'Run stopped',
            statusDetail: 'Status stopped',
            color: catppuccinMocha.colors.yellow
          };
        default:
          return {
            label: 'Run finished',
            statusDetail: `Status ${state.completion.status}`,
            color: catppuccinMocha.colors.yellow
          };
      }
    })();
    const hasHistory = state.completedFeatures.length > 0;

    return (
      <ThemeContext.Provider value={catppuccinMocha}>
        <Box flexDirection="column" width="100%" height={rows}>
          <StatusBar
            phase={null}
            activeCount={0}
            pendingCount={0}
            totalCount={state.agents.length}
            totalTokens={state.totalTokens}
            elapsed={state.elapsed}
            modelSelection={statusModelSelection}
          />
          <Box
            flexDirection="column"
            flexGrow={1}
            justifyContent="center"
            alignItems="center"
            borderStyle={catppuccinMocha.borders.panelActive}
            borderColor={completionPresentation.color}
          >
            <Text bold color={completionPresentation.color}>{completionPresentation.label}</Text>
            <Text color={catppuccinMocha.colors.subtext}>{completionPresentation.statusDetail}</Text>
            <Text>{`Planned ${state.completion.plannedCount} · Merged ${state.completion.mergedCount}`}</Text>
            {state.completion.finalHead !== undefined ? (
              <Text>{`HEAD ${state.completion.finalHead ?? 'unknown'}`}</Text>
            ) : null}
            {state.completion.durabilitySummary ? (
              <Text>{`Durability ${state.completion.durabilitySummary}`}</Text>
            ) : null}
            {state.completion.cleanupSummary ? (
              <Text color={catppuccinMocha.colors.subtext}>{state.completion.cleanupSummary}</Text>
            ) : null}
            <Text>{''}</Text>
            {hasHistory ? (
              <Text color={catppuccinMocha.colors.subtext}>{'Press h for history · q to exit'}</Text>
            ) : (
              <Text color={catppuccinMocha.colors.muted}>{'Press q to exit'}</Text>
            )}
          </Box>
        </Box>
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={catppuccinMocha}>
      <Box flexDirection="column" width="100%" height={rows}>
        <StatusBar
          phase={state.phase}
          activeCount={activeCount}
          pendingCount={pendingCount}
          totalCount={state.agents.length}
          totalTokens={state.totalTokens}
          elapsed={state.elapsed}
          modelSelection={statusModelSelection}
        />
        {state.notice ? (
          <Box>
            <Text color={state.notice.level === 'error' ? catppuccinMocha.colors.red : catppuccinMocha.colors.yellow}>
              {state.notice.message}
            </Text>
          </Box>
        ) : null}
        {state.showHelp ? (
          <HelpOverlay
            mode={state.mode}
            executionStarted={state.executionRequested}
            canEditModelSelection={canEditModelSelection}
          />
        ) : state.mode === 'model-menu' && state.modelSelection !== null && state.modelMenu !== null ? (
          <ModelMenu
            backend={state.modelSelection.backend}
            menu={state.modelMenu}
          />
        ) : (
          <Box flexDirection="column" flexGrow={1}>
            <MeterBar
              phase={state.phase}
              completedCount={completedCount}
              totalAgentCount={state.agents.length}
              totalTokens={state.totalTokens}
              elapsed={state.elapsed}
            />
            {state.addInputText !== null ? (
              <Box paddingX={1} marginX={1}>
                <TextInputField
                  value={state.addInputText}
                  onChange={(text) => store.getState().setAddInputText(text)}
                  onSubmit={(text) => {
                    const trimmed = text.trim();
                    if (trimmed && onAddRequest) onAddRequest(trimmed);
                  }}
                  onExit={() => store.getState().setAddInputText(null)}
                  cursorOffset={state.addInputCursorOffset}
                  onCursorOffsetChange={(offset) => store.getState().setAddInputCursorOffset(offset)}
                  prompt="> "
                  borderColor={catppuccinMocha.colors.green}
                />
              </Box>
            ) : state.mode === 'input' ? (
              <Box borderStyle="round" borderColor={catppuccinMocha.colors.surface1} paddingX={1} marginX={1}>
                <Text color={catppuccinMocha.colors.muted}>{'filter '}</Text>
                <Text>{state.filterText.slice(0, state.filterCursorOffset)}</Text>
                <Text color={catppuccinMocha.colors.muted}>{'█'}</Text>
                <Text>{state.filterText.slice(state.filterCursorOffset)}</Text>
              </Box>
            ) : null}
            <Box flexDirection="column" flexGrow={1}>
              {(showLoom || loomDissolving) ? (
                <EmptyState dissolving={loomDissolving} onDissolved={handleLoomDissolved} />
              ) : (
                filteredAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    name={agent.name}
                    feature={agent.feature}
                    status={agent.status}
                    focused={agent.id === state.focusedAgentId}
                    files={agent.files}
                    tokens={agent.tokens}
                    elapsed={agent.elapsed}
                    currentTool={agent.currentTool}
                    approvalRequest={agent.approvalRequest}
                    spinnerFrame={state.spinnerFrame}
                    readyStateDetail={
                      !state.executionRequested && agent.status === 'queued'
                        ? (agent.removable ? 'Press d to remove' : 'Resumable checkpoint')
                        : null
                    }
                  />
                ))
              )}
            </Box>
          </Box>
        )}
        <Footer
          mode={state.mode}
          executionStarted={state.executionRequested}
          composing={state.addInputText !== null}
          canEditModelSelection={canEditModelSelection}
        />
      </Box>
    </ThemeContext.Provider>
  );
};
