import type { StoreApi } from 'zustand/vanilla';

import type { AgentState, UIStore } from '../store.js';
import {
  deleteBackward,
  deleteBackwardWord,
  insertAtCursor,
  moveCursorLeft,
  moveCursorRight,
} from '../textEditing.js';

export type KeypressResult = 'handled' | 'quit' | 'unhandled';
export interface KeypressContext {
  readonly meta?: boolean;
}

export interface KeypressHandlers {
  onQuit?: (reason: 'keyboard') => void;
  onApprovalDecision?: (decision: 'approve' | 'deny' | 'skip' | 'always') => void;
  onStartRequest?: () => void;
  onRemoveAgent?: (agentId: string) => void;
}

export const filterAgents = (agents: readonly AgentState[], filterText: string): AgentState[] => {
  const query = filterText.toLowerCase();
  return query
    ? agents.filter((agent) =>
        agent.name.toLowerCase().includes(query) ||
        agent.feature.toLowerCase().includes(query)
      )
    : [...agents];
};

export const handleKeypress = (
  store: StoreApi<UIStore>,
  key: string,
  handlers: KeypressHandlers = {},
  context: KeypressContext = {},
): KeypressResult => {
  const state = store.getState();
  const visibleAgents = filterAgents(state.agents, state.filterText);

  const handleQuitRequest = (): KeypressResult => {
    if (state.quitConfirmPending) {
      state.setQuitConfirmPending(false);
      if (handlers.onQuit) {
        handlers.onQuit('keyboard');
        return 'handled';
      }
      return 'quit';
    }
    if (state.executionRequested) {
      state.setQuitConfirmPending(true);
      state.setNotice({ level: 'info', message: 'Press q again to stop after current phase, Esc to cancel' });
      return 'handled';
    }
    if (handlers.onQuit) {
      handlers.onQuit('keyboard');
      return 'handled';
    }
    return 'quit';
  };

  const syncFocusToVisible = (filterText: string): void => {
    const nextVisibleAgents = filterAgents(state.agents, filterText);
    if (!nextVisibleAgents.some((agent) => agent.id === state.focusedAgentId)) {
      state.setFocusedAgent(nextVisibleAgents[0]?.id ?? null);
    }
  };

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
        case '?': state.setShowHelp(true); return 'handled';
        case 'q':
          return handleQuitRequest();
        case 'escape':
          if (state.quitConfirmPending) {
            state.setQuitConfirmPending(false);
            state.setNotice(null);
            return 'handled';
          }
          return 'unhandled';
        case '/':
          if (state.quitConfirmPending) {
            state.setQuitConfirmPending(false);
            state.setNotice(null);
          }
          state.setMode('input');
          return 'handled';
        case 'd':
          if (state.focusedAgentId && handlers.onRemoveAgent) {
            const focused = visibleAgents.find((a) => a.id === state.focusedAgentId);
            if (focused?.removable) {
              handlers.onRemoveAgent(state.focusedAgentId);
              return 'handled';
            }
          }
          return 'unhandled';
        case 'a':
          state.setAddInputText('');
          return 'handled';

        case 'k':
        case 'up': {
          if (visibleAgents.length === 0) return 'handled';
          const idx = visibleAgents.findIndex((a) => a.id === state.focusedAgentId);
          if (idx === -1) {
            const first = visibleAgents[0];
            if (first !== undefined) state.setFocusedAgent(first.id);
            return 'handled';
          }
          if (idx > 0) {
            const prev = visibleAgents[idx - 1];
            if (prev !== undefined) state.setFocusedAgent(prev.id);
          }
          return 'handled';
        }

        case 'j':
        case 'down': {
          if (visibleAgents.length === 0) return 'handled';
          const idx = visibleAgents.findIndex((a) => a.id === state.focusedAgentId);
          if (idx === -1) {
            const first = visibleAgents[0];
            if (first !== undefined) state.setFocusedAgent(first.id);
            return 'handled';
          }
          if (idx < visibleAgents.length - 1) {
            const next = visibleAgents[idx + 1];
            if (next !== undefined) state.setFocusedAgent(next.id);
          }
          return 'handled';
        }

        case 's':
          if (!state.executionRequested && handlers.onStartRequest) {
            handlers.onStartRequest();
            return 'handled';
          }
          return 'unhandled';

        case 'return':
          return 'handled';

        default: return 'unhandled';
      }

    case 'approval':
      switch (key) {
        case 'escape':
          if (state.quitConfirmPending) {
            state.setQuitConfirmPending(false);
            state.setNotice(null);
          }
          state.setMode('normal');
          return 'handled';
        case 'q':
          return handleQuitRequest();
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
        case 'return':
          state.setMode('normal');
          return 'handled';
        case 'left':
          state.setFilterCursorOffset(
            moveCursorLeft({ value: state.filterText, cursorOffset: state.filterCursorOffset }).cursorOffset
          );
          return 'handled';
        case 'right':
          state.setFilterCursorOffset(
            moveCursorRight({ value: state.filterText, cursorOffset: state.filterCursorOffset }).cursorOffset
          );
          return 'handled';
        case 'backspace':
        case 'delete':
          {
            const nextState = context.meta
              ? deleteBackwardWord({ value: state.filterText, cursorOffset: state.filterCursorOffset })
              : deleteBackward({ value: state.filterText, cursorOffset: state.filterCursorOffset });
            const nextFilterText = nextState.value;
            state.setFilterText(nextState.value);
            state.setFilterCursorOffset(nextState.cursorOffset);
            syncFocusToVisible(nextFilterText);
          }
          return 'handled';
        default:
          if (key.length === 1) {
            const nextState = insertAtCursor(
              { value: state.filterText, cursorOffset: state.filterCursorOffset },
              key,
            );
            state.setFilterText(nextState.value);
            state.setFilterCursorOffset(nextState.cursorOffset);
            const nextFilterText = nextState.value;
            syncFocusToVisible(nextFilterText);
            return 'handled';
          }
          return 'unhandled';
      }
  }
};
