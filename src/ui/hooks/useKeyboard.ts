import type { StoreApi } from 'zustand/vanilla';

import type { UIStore } from '../store.js';

export type KeypressResult = 'handled' | 'quit' | 'unhandled';

export interface KeypressHandlers {
  onQuit?: (reason: 'keyboard') => void;
  onApprovalDecision?: (decision: 'approve' | 'deny' | 'skip' | 'always') => void;
  onStartRequest?: () => void;
  onRemoveAgent?: (agentId: string) => void;
}

export const handleKeypress = (
  store: StoreApi<UIStore>,
  key: string,
  handlers: KeypressHandlers = {}
): KeypressResult => {
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
        case 'q':
          if (state.quitConfirmPending) {
            // Second q confirms quit
            state.setQuitConfirmPending(false);
            if (handlers.onQuit) {
              handlers.onQuit('keyboard');
              return 'handled';
            }
            return 'quit';
          }
          if (state.executionRequested) {
            // During execution, require confirmation
            state.setQuitConfirmPending(true);
            state.setNotice({ level: 'info', message: 'Press q again to stop after current phase, Esc to cancel' });
            return 'handled';
          }
          // Ready state — quit immediately
          if (handlers.onQuit) {
            handlers.onQuit('keyboard');
            return 'handled';
          }
          return 'quit';
        case 'escape':
          if (state.quitConfirmPending) {
            state.setQuitConfirmPending(false);
            state.setNotice(null);
            return 'handled';
          }
          return 'unhandled';
        case '/': state.setMode('input'); return 'handled';
        case 'd':
          if (!state.executionRequested && state.focusedAgentId && handlers.onRemoveAgent) {
            handlers.onRemoveAgent(state.focusedAgentId);
            return 'handled';
          }
          return 'unhandled';

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

        case 's':
          if (!state.executionRequested && handlers.onStartRequest) {
            handlers.onStartRequest();
            return 'handled';
          }
          return 'unhandled';

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
        case 'q':
          if (handlers.onQuit) {
            handlers.onQuit('keyboard');
            return 'handled';
          }
          return 'quit';
        case 'y':
          handlers.onApprovalDecision?.('approve');
          return handlers.onApprovalDecision ? 'handled' : 'unhandled';
        case 'n':
          handlers.onApprovalDecision?.('deny');
          return handlers.onApprovalDecision ? 'handled' : 'unhandled';
        case 's':
          handlers.onApprovalDecision?.('skip');
          return handlers.onApprovalDecision ? 'handled' : 'unhandled';
        case 'a':
          handlers.onApprovalDecision?.('always');
          return handlers.onApprovalDecision ? 'handled' : 'unhandled';
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
