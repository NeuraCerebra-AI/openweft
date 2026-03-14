import type { StoreApi } from 'zustand/vanilla';

import type { UIStore } from '../store.js';

export type KeypressResult = 'handled' | 'quit' | 'unhandled';

export const handleKeypress = (store: StoreApi<UIStore>, key: string): KeypressResult => {
  const state = store.getState();

  // Help overlay takes priority
  if (state.showHelp) {
    if (key === 'escape' || key === '?') {
      state.setShowHelp(false);
      return 'handled';
    }
    return 'handled'; // Swallow all keys when help is open
  }

  // Mode-specific handling
  switch (state.mode) {
    case 'normal':
      switch (key) {
        case 'tab': state.togglePanel(); return 'handled';
        case '?': state.setShowHelp(true); return 'handled';
        case 'q': return 'quit';
        case '/': state.setMode('input'); return 'handled';

        case 'up':
          if (state.sidebarFocused) {
            const idx = state.agents.findIndex((a) => a.id === state.focusedAgentId);
            if (idx > 0) {
              const prev = state.agents[idx - 1];
              if (prev !== undefined) state.setFocusedAgent(prev.id);
            }
          } else {
            state.setScrollOffset(Math.max(0, state.scrollOffset - 1));
          }
          return 'handled';

        case 'down':
          if (state.sidebarFocused) {
            const idx = state.agents.findIndex((a) => a.id === state.focusedAgentId);
            if (idx < state.agents.length - 1) {
              const next = state.agents[idx + 1];
              if (next !== undefined) state.setFocusedAgent(next.id);
            }
          } else {
            const agent = state.agents.find((a) => a.id === state.focusedAgentId);
            const maxOffset = agent !== undefined ? Math.max(0, agent.outputLines.length - 1) : 0;
            state.setScrollOffset(Math.min(state.scrollOffset + 1, maxOffset));
          }
          return 'handled';

        case 'return':
          if (state.sidebarFocused) {
            state.togglePanel();
          }
          return 'handled';

        default: return 'unhandled';
      }

    case 'approval':
      switch (key) {
        case 'escape': state.setMode('normal'); return 'handled';
        default: return 'unhandled';
      }

    case 'input':
      switch (key) {
        case 'escape':
          state.setMode('normal');
          state.setFilterText('');
          return 'handled';
        default: return 'unhandled';
      }
  }
};
