import { describe, it, expect } from 'vitest';
import { createUIStore } from '../../../src/ui/store.js';
import { handleKeypress } from '../../../src/ui/hooks/useKeyboard.js';

describe('handleKeypress', () => {
  it('toggles panel on Tab in normal mode', () => {
    const store = createUIStore();
    expect(store.getState().sidebarFocused).toBe(true);
    handleKeypress(store, 'tab');
    expect(store.getState().sidebarFocused).toBe(false);
  });

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
    store.getState().setMode('approval');
    const result = handleKeypress(store, 'q', {
      onQuit: (reason) => {
        requests.push(reason);
      }
    });
    expect(result).toBe('handled');
    expect(requests).toEqual(['keyboard']);
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

  it('navigates down through agents with arrow keys when sidebar focused', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'Alpha', feature: 'auth' });
    store.getState().addAgent({ id: 'a2', name: 'Beta', feature: 'api' });
    store.getState().setFocusedAgent('a1');
    handleKeypress(store, 'down');
    expect(store.getState().focusedAgentId).toBe('a2');
  });

  it('navigates up through agents with arrow keys when sidebar focused', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'Alpha', feature: 'auth' });
    store.getState().addAgent({ id: 'a2', name: 'Beta', feature: 'api' });
    store.getState().setFocusedAgent('a2');
    handleKeypress(store, 'up');
    expect(store.getState().focusedAgentId).toBe('a1');
  });

  it('scrolls main panel with arrow keys when main panel focused', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'Alpha', feature: 'auth' });
    store.getState().setFocusedAgent('a1');
    store.getState().appendOutput('a1', { type: 'text', content: 'line1', timestamp: Date.now() });
    store.getState().appendOutput('a1', { type: 'text', content: 'line2', timestamp: Date.now() });
    store.getState().togglePanel(); // switch to main panel
    handleKeypress(store, 'down');
    expect(store.getState().scrollOffset).toBe(1);
    handleKeypress(store, 'up');
    expect(store.getState().scrollOffset).toBe(0);
  });

  it('does not scroll below zero', () => {
    const store = createUIStore();
    store.getState().togglePanel(); // main panel
    handleKeypress(store, 'up');
    expect(store.getState().scrollOffset).toBe(0);
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
    store.getState().addAgent({ id: 'a1', name: 'A1', feature: 'f1', status: 'queued' });
    store.getState().addAgent({ id: 'a2', name: 'A2', feature: 'f2', status: 'queued' });
    store.getState().setFocusedAgent('a1');
    const removed: string[] = [];
    const result = handleKeypress(store, 'd', {
      onRemoveAgent: (id) => { removed.push(id); }
    });
    expect(result).toBe('handled');
    expect(removed).toEqual(['a1']);
  });

  it('d does nothing during execution', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'A1', feature: 'f1', status: 'queued' });
    store.getState().setFocusedAgent('a1');
    store.getState().requestExecution();
    const removed: string[] = [];
    const result = handleKeypress(store, 'd', {
      onRemoveAgent: (id) => { removed.push(id); }
    });
    expect(result).toBe('unhandled');
    expect(removed).toEqual([]);
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
});
