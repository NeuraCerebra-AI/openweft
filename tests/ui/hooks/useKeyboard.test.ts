import { describe, it, expect } from 'vitest';
import { createUIStore } from '../../../src/ui/store.js';
import { handleKeypress } from '../../../src/ui/hooks/useKeyboard.js';

describe('handleKeypress', () => {
  it('toggles help on ?', () => {
    const store = createUIStore();
    handleKeypress(store, '?');
    expect(store.getState().showHelp).toBe(true);
    handleKeypress(store, '?');
    expect(store.getState().showHelp).toBe(false);
  });

  it('returns to normal on Esc from approval', () => {
    const store = createUIStore();
    store.getState().setMode('approval');
    handleKeypress(store, 'escape');
    expect(store.getState().mode).toBe('normal');
  });

  it('requests graceful quit on q from approval mode when a quit callback is provided', () => {
    const store = createUIStore();
    const requests: string[] = [];
    store.getState().requestExecution();
    store.getState().setMode('approval');
    const result = handleKeypress(store, 'q', {
      onQuit: (reason) => {
        requests.push(reason);
      }
    });
    expect(result).toBe('handled');
    expect(requests).toEqual([]);
    expect(store.getState().quitConfirmPending).toBe(true);
    expect(store.getState().notice?.message).toContain('Press q again');
  });

  it('confirms graceful quit on second q from approval mode', () => {
    const store = createUIStore();
    const requests: string[] = [];
    store.getState().requestExecution();
    store.getState().setMode('approval');

    handleKeypress(store, 'q', {
      onQuit: (reason) => {
        requests.push(reason);
      }
    });

    const result = handleKeypress(store, 'q', {
      onQuit: (reason) => {
        requests.push(reason);
      }
    });

    expect(result).toBe('handled');
    expect(requests).toEqual(['keyboard']);
    expect(store.getState().quitConfirmPending).toBe(false);
  });

  it('returns to normal on Esc from help', () => {
    const store = createUIStore();
    store.getState().setShowHelp(true);
    handleKeypress(store, 'escape');
    expect(store.getState().showHelp).toBe(false);
  });

  it('returns quit signal on q in normal mode', () => {
    const store = createUIStore();
    const result = handleKeypress(store, 'q');
    expect(result).toBe('quit');
  });

  it('requests graceful quit when a quit callback is provided', () => {
    const store = createUIStore();
    const requests: string[] = [];
    const result = handleKeypress(store, 'q', {
      onQuit: (reason) => {
        requests.push(reason);
      }
    });
    expect(result).toBe('handled');
    expect(requests).toEqual(['keyboard']);
  });

  it('navigates down through agents with arrow keys', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'Alpha', feature: 'auth' });
    store.getState().addAgent({ id: 'a2', name: 'Beta', feature: 'api' });
    store.getState().setFocusedAgent('a1');
    handleKeypress(store, 'down');
    expect(store.getState().focusedAgentId).toBe('a2');
  });

  it('navigates up through agents with arrow keys', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'Alpha', feature: 'auth' });
    store.getState().addAgent({ id: 'a2', name: 'Beta', feature: 'api' });
    store.getState().setFocusedAgent('a2');
    handleKeypress(store, 'up');
    expect(store.getState().focusedAgentId).toBe('a1');
  });

  it('navigates agents with j and k', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'Alpha', feature: 'auth' });
    store.getState().addAgent({ id: 'a2', name: 'Beta', feature: 'api' });
    store.getState().setFocusedAgent('a1');
    handleKeypress(store, 'j');
    expect(store.getState().focusedAgentId).toBe('a2');
    handleKeypress(store, 'k');
    expect(store.getState().focusedAgentId).toBe('a1');
  });

  it('resolves approval decisions through callbacks', () => {
    const store = createUIStore();
    const decisions: string[] = [];
    store.getState().addAgent({ id: 'a1', name: 'Alpha', feature: 'auth' });
    store.getState().setFocusedAgent('a1');
    store.getState().updateAgent('a1', {
      status: 'approval',
      approvalRequest: { file: 'src/index.ts', action: 'write', detail: 'Add auth import' }
    });
    store.getState().setMode('approval');

    expect(handleKeypress(store, 'y', {
      onApprovalDecision: (decision) => {
        decisions.push(decision);
      }
    })).toBe('handled');
    expect(handleKeypress(store, 'n', {
      onApprovalDecision: (decision) => {
        decisions.push(decision);
      }
    })).toBe('handled');
    expect(handleKeypress(store, 's', {
      onApprovalDecision: (decision) => {
        decisions.push(decision);
      }
    })).toBe('handled');
    expect(handleKeypress(store, 'a', {
      onApprovalDecision: (decision) => {
        decisions.push(decision);
      }
    })).toBe('handled');

    expect(decisions).toEqual(['approve', 'deny', 'skip', 'always']);
  });

  it('fires onStartRequest on s in normal mode when execution not yet requested', () => {
    const store = createUIStore();
    const starts: boolean[] = [];
    const result = handleKeypress(store, 's', {
      onStartRequest: () => { starts.push(true); }
    });
    expect(result).toBe('handled');
    expect(starts).toEqual([true]);
  });

  it('opens the model menu on m in ready state when editing is supported', () => {
    const store = createUIStore();
    store.getState().setModelSelection({
      backend: 'codex',
      model: 'gpt-5.5',
      effort: 'medium',
      editable: true
    });

    const result = handleKeypress(store, 'm');

    expect(result).toBe('handled');
    expect(store.getState().mode).toBe('model-menu');
    expect(store.getState().modelMenu).toEqual({
      model: 'gpt-5.5',
      effort: 'medium',
      focus: 'model'
    });
  });

  it('shows a notice on m in ready state when editing is unsupported', () => {
    const store = createUIStore();
    store.getState().setModelSelection({
      backend: 'codex',
      model: 'gpt-5.5',
      effort: 'medium',
      editable: false
    });

    const result = handleKeypress(store, 'm');

    expect(result).toBe('handled');
    expect(store.getState().mode).toBe('normal');
    expect(store.getState().notice).toEqual({
      level: 'info',
      message: 'Model editing is only supported for dedicated JSON config files.'
    });
  });

  it('ignores s in normal mode when execution already requested', () => {
    const store = createUIStore();
    store.getState().requestExecution();
    const starts: boolean[] = [];
    const result = handleKeypress(store, 's', {
      onStartRequest: () => { starts.push(true); }
    });
    expect(result).toBe('unhandled');
    expect(starts).toEqual([]);
  });

  it('ignores m after execution has already started', () => {
    const store = createUIStore();
    store.getState().setModelSelection({
      backend: 'codex',
      model: 'gpt-5.5',
      effort: 'medium',
      editable: true
    });
    store.getState().requestExecution();

    const result = handleKeypress(store, 'm');

    expect(result).toBe('unhandled');
    expect(store.getState().mode).toBe('normal');
    expect(store.getState().modelMenu).toBeNull();
  });

  it('s still means skip in approval mode', () => {
    const store = createUIStore();
    store.getState().setMode('approval');
    const decisions: string[] = [];
    const result = handleKeypress(store, 's', {
      onApprovalDecision: (d) => { decisions.push(d); }
    });
    expect(result).toBe('handled');
    expect(decisions).toEqual(['skip']);
  });

  it('d removes focused agent in ready state', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'A1', feature: 'f1', status: 'queued', removable: true });
    store.getState().addAgent({ id: 'a2', name: 'A2', feature: 'f2', status: 'queued', removable: true });
    store.getState().setFocusedAgent('a1');
    const removed: string[] = [];
    const result = handleKeypress(store, 'd', {
      onRemoveAgent: (id) => { removed.push(id); }
    });
    expect(result).toBe('handled');
    expect(removed).toEqual(['a1']);
  });

  it('d removes focused queued agent during execution', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'r1', name: 'Running', feature: 'f1', status: 'running', removable: false });
    store.getState().addAgent({ id: 'q1', name: 'Queued', feature: 'f2', status: 'queued', removable: true });
    store.getState().setFocusedAgent('q1');
    store.getState().requestExecution();
    const removed: string[] = [];
    const result = handleKeypress(store, 'd', {
      onRemoveAgent: (id) => { removed.push(id); }
    });
    expect(result).toBe('handled');
    expect(removed).toEqual(['q1']);
  });

  it('d does nothing with no focused agent', () => {
    const store = createUIStore();
    const removed: string[] = [];
    const result = handleKeypress(store, 'd', {
      onRemoveAgent: (id) => { removed.push(id); }
    });
    expect(result).toBe('unhandled');
    expect(removed).toEqual([]);
  });

  it('q in ready state quits immediately', () => {
    const store = createUIStore();
    const result = handleKeypress(store, 'q');
    expect(result).toBe('quit');
    expect(store.getState().quitConfirmPending).toBe(false);
  });

  it('q during execution shows confirmation', () => {
    const store = createUIStore();
    store.getState().requestExecution();
    const result = handleKeypress(store, 'q');
    expect(result).toBe('handled');
    expect(store.getState().quitConfirmPending).toBe(true);
    expect(store.getState().notice).not.toBeNull();
  });

  it('second q during execution confirms quit', () => {
    const store = createUIStore();
    store.getState().requestExecution();
    handleKeypress(store, 'q'); // first q — sets confirmation
    const result = handleKeypress(store, 'q'); // second q — confirms
    expect(result).toBe('quit');
    expect(store.getState().quitConfirmPending).toBe(false);
  });

  it('Esc cancels quit confirmation', () => {
    const store = createUIStore();
    store.getState().requestExecution();
    handleKeypress(store, 'q'); // sets confirmation
    expect(store.getState().quitConfirmPending).toBe(true);
    const result = handleKeypress(store, 'escape');
    expect(result).toBe('handled');
    expect(store.getState().quitConfirmPending).toBe(false);
    expect(store.getState().notice).toBeNull();
  });

  it('a enters add mode in ready state', () => {
    const store = createUIStore();
    const result = handleKeypress(store, 'a');
    expect(result).toBe('handled');
    expect(store.getState().addInputText).toBe('');
  });

  it('navigates and saves from the model menu', () => {
    const store = createUIStore();
    const saved: Array<{ model: string; effort: string }> = [];
    store.getState().setModelSelection({
      backend: 'codex',
      model: 'gpt-5.5',
      effort: 'medium',
      editable: true
    });

    handleKeypress(store, 'm');
    handleKeypress(store, 'right');
    handleKeypress(store, 'down');
    handleKeypress(store, 'right');
    handleKeypress(store, 'down');

    const result = handleKeypress(store, 'return', {
      onSaveModelSelection: (selection) => {
        saved.push(selection);
      }
    });

    expect(result).toBe('handled');
    expect(saved).toEqual([{ model: 'gpt-5.4', effort: 'high' }]);
  });

  it('esc closes the model menu without saving', () => {
    const store = createUIStore();
    store.getState().setModelSelection({
      backend: 'codex',
      model: 'gpt-5.5',
      effort: 'medium',
      editable: true
    });

    handleKeypress(store, 'm');
    const result = handleKeypress(store, 'escape');

    expect(result).toBe('handled');
    expect(store.getState().mode).toBe('normal');
    expect(store.getState().modelMenu).toBeNull();
  });

  it('a enters add mode during execution', () => {
    const store = createUIStore();
    store.getState().requestExecution();
    const result = handleKeypress(store, 'a');
    expect(result).toBe('handled');
    expect(store.getState().addInputText).toBe('');
  });

  it('d blocked on non-removable agent', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'cp1', name: 'CP', feature: 'f1', status: 'queued', removable: false });
    store.getState().setFocusedAgent('cp1');
    const removed: string[] = [];
    const result = handleKeypress(store, 'd', {
      onRemoveAgent: (id) => { removed.push(id); }
    });
    expect(result).toBe('unhandled');
    expect(removed).toEqual([]);
  });

  it('d works on removable agent', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'q1', name: 'Q1', feature: 'f1', status: 'queued', removable: true });
    store.getState().setFocusedAgent('q1');
    const removed: string[] = [];
    const result = handleKeypress(store, 'd', {
      onRemoveAgent: (id) => { removed.push(id); }
    });
    expect(result).toBe('handled');
    expect(removed).toEqual(['q1']);
  });

  it('typing in INPUT mode appends to filterText', () => {
    const store = createUIStore();
    store.getState().setMode('input');
    handleKeypress(store, 'a');
    handleKeypress(store, 'b');
    expect(store.getState().filterText).toBe('ab');
  });

  it('backspace in INPUT mode removes last char', () => {
    const store = createUIStore();
    store.getState().setMode('input');
    store.getState().setFilterText('abc');
    handleKeypress(store, 'backspace');
    expect(store.getState().filterText).toBe('ab');
  });

  it('moves the filter cursor left and inserts at the cursor in INPUT mode', () => {
    const store = createUIStore();
    store.getState().setMode('input');
    store.getState().setFilterText('helo');
    handleKeypress(store, 'left');
    handleKeypress(store, 'l');
    expect(store.getState().filterText).toBe('hello');
    expect(store.getState().filterCursorOffset).toBe(4);
  });

  it('deletes the previous word in INPUT mode for meta-modified delete/backspace', () => {
    const store = createUIStore();
    store.getState().setMode('input');
    store.getState().setFilterText('hello world');
    const result = handleKeypress(store, 'delete', {}, { meta: true });
    expect(result).toBe('handled');
    expect(store.getState().filterText).toBe('hello ');
    expect(store.getState().filterCursorOffset).toBe(6);
  });

  it('backspace in INPUT mode on empty filter stays handled and empty', () => {
    const store = createUIStore();
    store.getState().setMode('input');
    const result = handleKeypress(store, 'backspace');
    expect(result).toBe('handled');
    expect(store.getState().filterText).toBe('');
  });

  it('Enter in INPUT mode returns to normal with filter kept', () => {
    const store = createUIStore();
    store.getState().setMode('input');
    store.getState().setFilterText('auth');
    handleKeypress(store, 'return');
    expect(store.getState().mode).toBe('normal');
    expect(store.getState().filterText).toBe('auth');
  });

  it('Esc in INPUT mode clears filter and returns to normal', () => {
    const store = createUIStore();
    store.getState().setMode('input');
    store.getState().setFilterText('auth');
    handleKeypress(store, 'escape');
    expect(store.getState().mode).toBe('normal');
    expect(store.getState().filterText).toBe('');
  });

  it('navigates only through visible agents when filter is active', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'Auth One', feature: 'auth-login' });
    store.getState().addAgent({ id: 'a2', name: 'Billing', feature: 'payments' });
    store.getState().addAgent({ id: 'a3', name: 'Auth Two', feature: 'auth-signup' });
    store.getState().setFocusedAgent('a1');
    store.getState().setFilterText('auth');
    handleKeypress(store, 'down');
    expect(store.getState().focusedAgentId).toBe('a3');
    handleKeypress(store, 'up');
    expect(store.getState().focusedAgentId).toBe('a1');
  });

  it('d is unhandled when focused agent is filtered out', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'Alpha', feature: 'auth', removable: true });
    store.getState().addAgent({ id: 'a2', name: 'Billing', feature: 'payments', removable: true });
    store.getState().setFocusedAgent('a1');
    store.getState().setFilterText('bill');
    const removed: string[] = [];
    const result = handleKeypress(store, 'd', {
      onRemoveAgent: (id) => { removed.push(id); }
    });
    expect(result).toBe('unhandled');
    expect(removed).toEqual([]);
  });

  it('typing in INPUT mode rehomes focus to the first visible agent', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'Alpha', feature: 'auth' });
    store.getState().addAgent({ id: 'a2', name: 'Billing', feature: 'payments' });
    store.getState().setFocusedAgent('a1');
    store.getState().setMode('input');
    handleKeypress(store, 'b');
    expect(store.getState().filterText).toBe('b');
    expect(store.getState().focusedAgentId).toBe('a2');
  });

  it('typing in INPUT mode can clear focus when there are no matches', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'Alpha', feature: 'auth' });
    store.getState().setFocusedAgent('a1');
    store.getState().setMode('input');
    handleKeypress(store, 'z');
    expect(store.getState().focusedAgentId).toBeNull();
  });

  it('slash clears quit confirmation before entering INPUT mode', () => {
    const store = createUIStore();
    store.getState().requestExecution();
    handleKeypress(store, 'q');
    expect(store.getState().quitConfirmPending).toBe(true);
    const result = handleKeypress(store, '/');
    expect(result).toBe('handled');
    expect(store.getState().mode).toBe('input');
    expect(store.getState().quitConfirmPending).toBe(false);
    expect(store.getState().notice).toBeNull();
  });

  it('h opens history when completed features exist', () => {
    const store = createUIStore();
    store.getState().setCompletedFeatures([
      { id: 'f1', request: 'Add auth', mergeCommit: 'abc1234' }
    ]);
    const result = handleKeypress(store, 'h');
    expect(result).toBe('handled');
    expect(store.getState().mode).toBe('history');
    expect(store.getState().historyFocusedIndex).toBe(0);
  });

  it('h is unhandled when no completed features', () => {
    const store = createUIStore();
    const result = handleKeypress(store, 'h');
    expect(result).toBe('unhandled');
    expect(store.getState().mode).toBe('normal');
  });

  it('Esc in history mode returns to normal', () => {
    const store = createUIStore();
    store.getState().setCompletedFeatures([
      { id: 'f1', request: 'Add auth', mergeCommit: 'abc1234' }
    ]);
    store.getState().setMode('history');
    const result = handleKeypress(store, 'escape');
    expect(result).toBe('handled');
    expect(store.getState().mode).toBe('normal');
  });

  it('j/k navigate history focused index', () => {
    const store = createUIStore();
    store.getState().setCompletedFeatures([
      { id: 'f1', request: 'Add auth', mergeCommit: 'abc1234' },
      { id: 'f2', request: 'Add logging', mergeCommit: 'def5678' }
    ]);
    store.getState().setMode('history');
    store.getState().setHistoryFocusedIndex(0);
    handleKeypress(store, 'j');
    expect(store.getState().historyFocusedIndex).toBe(1);
    handleKeypress(store, 'k');
    expect(store.getState().historyFocusedIndex).toBe(0);
  });

  it('j does not go past the end of history', () => {
    const store = createUIStore();
    store.getState().setCompletedFeatures([
      { id: 'f1', request: 'Add auth', mergeCommit: 'abc1234' }
    ]);
    store.getState().setMode('history');
    store.getState().setHistoryFocusedIndex(0);
    handleKeypress(store, 'j');
    expect(store.getState().historyFocusedIndex).toBe(0);
  });

  it('k does not go below 0', () => {
    const store = createUIStore();
    store.getState().setCompletedFeatures([
      { id: 'f1', request: 'Add auth', mergeCommit: 'abc1234' }
    ]);
    store.getState().setMode('history');
    store.getState().setHistoryFocusedIndex(0);
    handleKeypress(store, 'k');
    expect(store.getState().historyFocusedIndex).toBe(0);
  });

  it('Enter in history mode opens detail', () => {
    const store = createUIStore();
    store.getState().setCompletedFeatures([
      { id: 'f1', request: 'Add auth', mergeCommit: 'abc1234' }
    ]);
    store.getState().setMode('history');
    const result = handleKeypress(store, 'return');
    expect(result).toBe('handled');
    expect(store.getState().mode).toBe('history-detail');
  });

  it('Esc in history-detail returns to history list', () => {
    const store = createUIStore();
    store.getState().setMode('history-detail');
    const result = handleKeypress(store, 'escape');
    expect(result).toBe('handled');
    expect(store.getState().mode).toBe('history');
  });

  it('q at completion screen dismisses immediately', () => {
    const store = createUIStore();
    store.getState().requestExecution();
    store.getState().setCompletion({ status: 'completed', plannedCount: 1, mergedCount: 1 });
    const result = handleKeypress(store, 'q');
    expect(result).toBe('quit');
    expect(store.getState().completionDismissed).toBe(true);
    expect(store.getState().quitConfirmPending).toBe(false);
  });

  it('q in history mode quits', () => {
    const store = createUIStore();
    store.getState().setMode('history');
    const result = handleKeypress(store, 'q');
    expect(result).toBe('quit');
  });
});
