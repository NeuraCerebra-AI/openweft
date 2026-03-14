import React, { useEffect, useRef } from 'react';
import { Box, useInput, useApp } from 'ink';
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
}

// StatusBar (1 line) + Footer (1 line) + borders (2 lines) = 4 lines reserved
const CHROME_LINES = 4;

export const App: React.FC<AppProps> = ({ store }) => {
  const state = useStore(store);
  const { exit } = useApp();
  const { rows } = useTerminalSize();

  const focusedAgent = state.agents.find((a) => a.id === state.focusedAgentId) ?? null;
  const activeCount = state.agents.filter((a) => a.status === 'running').length;
  const viewportHeight = Math.max(5, rows - CHROME_LINES);

  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      store.getState().setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [store]);

  useInput((_input, key) => {
    const keyName = key.tab ? 'tab'
      : key.escape ? 'escape'
      : key.return ? 'return'
      : key.upArrow ? 'up'
      : key.downArrow ? 'down'
      : _input;

    const result = handleKeypress(store, keyName);
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
        <Footer mode={state.mode} />
      </Box>
    </ThemeContext.Provider>
  );
};
