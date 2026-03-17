import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { useStore } from 'zustand/react';
import type { StoreApi } from 'zustand/vanilla';

import { ThemeContext, catppuccinMocha } from './theme.js';
import { StatusBar } from './StatusBar.js';
import { MeterBar } from './MeterBar.js';
import { AgentCard } from './AgentCard.js';
import { HelpOverlay } from './HelpOverlay.js';
import { EmptyState } from './EmptyState.js';
import { Footer } from './Footer.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { filterAgents, handleKeypress } from './hooks/useKeyboard.js';
import type { UIStore } from './store.js';
import {
  deleteBackward,
  deleteBackwardWord,
  insertAtCursor,
  moveCursorLeft,
  moveCursorRight,
} from './textEditing.js';

interface AppProps {
  readonly store: StoreApi<UIStore>;
  readonly onQuitRequest?: (reason: 'keyboard') => void;
  readonly onApprovalDecision?: (decision: 'approve' | 'deny' | 'skip' | 'always') => void;
  readonly onStartRequest?: () => void;
  readonly onRemoveAgent?: (agentId: string) => void;
  readonly onAddRequest?: (request: string) => void;
}

const NOTICE_AUTO_CLEAR_MS = 5000;

export const App: React.FC<AppProps> = ({ store, onQuitRequest, onApprovalDecision, onStartRequest, onRemoveAgent, onAddRequest }) => {
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
      const currentAddCursorOffset = store.getState().addInputCursorOffset;
      if (key.escape) {
        store.getState().setAddInputText(null);
        return;
      }
      if (key.return) {
        const trimmed = currentAddText.trim();
        if (trimmed && onAddRequest) onAddRequest(trimmed);
        return;
      }
      if (key.leftArrow) {
        store.getState().setAddInputCursorOffset(
          moveCursorLeft({ value: currentAddText, cursorOffset: currentAddCursorOffset }).cursorOffset
        );
        return;
      }
      if (key.rightArrow) {
        store.getState().setAddInputCursorOffset(
          moveCursorRight({ value: currentAddText, cursorOffset: currentAddCursorOffset }).cursorOffset
        );
        return;
      }
      // Ctrl+W — word delete (Unix standard)
      if (_input === 'w' && key.ctrl) {
        const nextState = deleteBackwardWord({ value: currentAddText, cursorOffset: currentAddCursorOffset });
        store.getState().setAddInputText(nextState.value);
        store.getState().setAddInputCursorOffset(nextState.cursorOffset);
        return;
      }
      if (key.backspace || key.delete) {
        const nextState = (key.meta || key.ctrl)
          ? deleteBackwardWord({ value: currentAddText, cursorOffset: currentAddCursorOffset })
          : deleteBackward({ value: currentAddText, cursorOffset: currentAddCursorOffset });
        store.getState().setAddInputText(nextState.value);
        store.getState().setAddInputCursorOffset(nextState.cursorOffset);
        return;
      }
      if (_input && !key.ctrl && !key.meta) {
        const nextState = insertAtCursor(
          { value: currentAddText, cursorOffset: currentAddCursorOffset },
          _input,
        );
        store.getState().setAddInputText(nextState.value);
        store.getState().setAddInputCursorOffset(nextState.cursorOffset);
      }
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
    }, { meta: key.meta, ctrl: key.ctrl });
    if (result === 'quit') {
      exit();
    }
  });

  if (state.completion !== null) {
    const completionLabel = state.completion.status === 'completed' ? 'Run complete' : 'Run finished';
    const completionColor = state.completion.status === 'completed'
      ? catppuccinMocha.colors.green
      : catppuccinMocha.colors.yellow;

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
          />
          <Box
            flexDirection="column"
            flexGrow={1}
            justifyContent="center"
            alignItems="center"
            borderStyle={catppuccinMocha.borders.panelActive}
            borderColor={completionColor}
          >
            <Text bold color={completionColor}>{completionLabel}</Text>
            <Text>{`Planned ${state.completion.plannedCount} · Merged ${state.completion.mergedCount}`}</Text>
            <Text color={catppuccinMocha.colors.muted}>{`Status: ${state.completion.status}`}</Text>
            <Text color={catppuccinMocha.colors.muted}>{'Returning to shell...'}</Text>
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
        />
        {state.notice ? (
          <Box>
            <Text color={state.notice.level === 'error' ? catppuccinMocha.colors.red : catppuccinMocha.colors.yellow}>
              {state.notice.message}
            </Text>
          </Box>
        ) : null}
        {state.showHelp ? (
          <HelpOverlay mode={state.mode} executionStarted={state.executionRequested} />
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
              <Box borderStyle="round" borderColor={catppuccinMocha.colors.green} paddingX={1} marginX={1}>
                <Text color={catppuccinMocha.colors.green}>{'> '}</Text>
                <Text>{state.addInputText.slice(0, state.addInputCursorOffset)}</Text>
                <Text color={catppuccinMocha.colors.muted}>{'█'}</Text>
                <Text>{state.addInputText.slice(state.addInputCursorOffset)}</Text>
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
                    cost={agent.cost}
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
        <Footer mode={state.mode} executionStarted={state.executionRequested} composing={state.addInputText !== null} />
      </Box>
    </ThemeContext.Provider>
  );
};
