import React, { useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { useStore } from 'zustand/react';
import type { StoreApi } from 'zustand/vanilla';

import { ThemeContext, catppuccinMocha } from './theme.js';
import { StatusBar } from './StatusBar.js';
import { Sidebar } from './Sidebar.js';
import { MainPanel } from './MainPanel.js';
import { HelpOverlay } from './HelpOverlay.js';
import { Footer } from './Footer.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { handleKeypress } from './hooks/useKeyboard.js';
import type { UIStore } from './store.js';

interface AppProps {
  readonly store: StoreApi<UIStore>;
  readonly onQuitRequest?: (reason: 'keyboard') => void;
  readonly onApprovalDecision?: (decision: 'approve' | 'deny' | 'skip' | 'always') => void;
  readonly onStartRequest?: () => void;
}

// StatusBar (1 line) + Footer (1 line) + borders (2 lines) = 4 lines reserved
const BASE_CHROME_LINES = 4;

export const App: React.FC<AppProps> = ({ store, onQuitRequest, onApprovalDecision, onStartRequest }) => {
  const state = useStore(store);
  const { exit } = useApp();
  const { rows } = useTerminalSize();

  const focusedAgent = state.agents.find((a) => a.id === state.focusedAgentId) ?? null;
  const activeCount = state.agents.filter((a) => a.status === 'running' || a.status === 'approval').length;
  const chromeLines = BASE_CHROME_LINES + (state.notice ? 1 : 0);
  const viewportHeight = Math.max(5, rows - chromeLines);

  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!state.executionRequested) return;
    if (startTimeRef.current === null) startTimeRef.current = Date.now();
    const origin = startTimeRef.current;
    const timer = setInterval(() => {
      const currentState = store.getState();
      currentState.setElapsed(Math.floor((Date.now() - origin) / 1000));
      currentState.tickAgentElapsed();
    }, 1000);
    return () => clearInterval(timer);
  }, [store, state.executionRequested]);

  useInput((_input, key) => {
    const keyName = key.tab ? 'tab'
      : key.escape ? 'escape'
      : key.return ? 'return'
      : key.upArrow ? 'up'
      : key.downArrow ? 'down'
      : _input;

    const result = handleKeypress(store, keyName, {
      ...(onQuitRequest ? { onQuit: onQuitRequest } : {}),
      ...(onApprovalDecision ? { onApprovalDecision } : {}),
      ...(onStartRequest ? { onStartRequest } : {}),
    });
    if (result === 'quit') {
      exit();
    }
  });

  return (
    <ThemeContext.Provider value={catppuccinMocha}>
      <Box flexDirection="column" width="100%" height={rows}>
        <StatusBar
          phase={state.phase}
          activeCount={activeCount}
          totalCount={state.agents.length}
          cost={state.totalCost}
          elapsed={state.elapsed}
        />
        {state.notice ? (
          <Box>
            <Text color={state.notice.level === 'error' ? catppuccinMocha.colors.red : catppuccinMocha.colors.yellow}>
              {state.notice.message}
            </Text>
          </Box>
        ) : null}
        <Box flexDirection="row" flexGrow={1}>
          <Sidebar
            agents={state.agents}
            focusedAgentId={state.focusedAgentId}
            phase={state.phase}
            totalCost={state.totalCost}
            isFocused={state.sidebarFocused}
          />
          {state.showHelp ? (
            <HelpOverlay />
          ) : (
            <MainPanel
              agentName={focusedAgent?.name ?? null}
              lines={focusedAgent?.outputLines ?? []}
              scrollOffset={state.scrollOffset}
              viewportHeight={viewportHeight}
            />
          )}
        </Box>
        <Footer mode={state.mode} executionStarted={state.executionRequested} />
      </Box>
    </ThemeContext.Provider>
  );
};
