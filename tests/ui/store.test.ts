import { describe, it, expect, beforeEach } from 'vitest';
import { createUIStore } from '../../src/ui/store.js';

describe('UIStore', () => {
  let store: ReturnType<typeof createUIStore>;

  beforeEach(() => {
    store = createUIStore();
  });

  it('initializes with empty state', () => {
    const state = store.getState();
    expect(state.agents).toEqual([]);
    expect(state.focusedAgentId).toBeNull();
    expect(state.mode).toBe('normal');
    expect(state.phase).toBeNull();
    expect(state.totalCost).toBe(0);
    expect(state.spinnerFrame).toBe(0);
    expect(state.completion).toBeNull();
    expect(state.showHelp).toBe(false);
  });

  it('adds an agent via addAgent', () => {
    store.getState().addAgent({ id: 'alpha', name: 'Alpha', feature: 'auth' });
    const state = store.getState();
    expect(state.agents).toHaveLength(1);
    expect(state.agents[0]?.id).toBe('alpha');
    expect(state.agents[0]?.status).toBe('running');
    expect(state.agents[0]?.outputLines).toEqual([]);
  });

  it('updates an agent via updateAgent', () => {
    store.getState().addAgent({ id: 'alpha', name: 'Alpha', feature: 'auth' });
    store.getState().updateAgent('alpha', { status: 'completed', cost: 0.12 });
    const agent = store.getState().agents[0];
    expect(agent?.status).toBe('completed');
    expect(agent?.cost).toBe(0.12);
  });

  it('appends output lines and caps at MAX_LINES', () => {
    store.getState().addAgent({ id: 'alpha', name: 'Alpha', feature: 'auth' });
    store.getState().appendOutput('alpha', { type: 'text', content: 'hello', timestamp: Date.now() });
    const agent = store.getState().agents[0];
    expect(agent?.outputLines).toHaveLength(1);
    expect(agent?.outputLines[0]?.content).toBe('hello');
  });

  it('sets focused agent', () => {
    store.getState().setFocusedAgent('alpha');
    expect(store.getState().focusedAgentId).toBe('alpha');
  });

  it('sets mode', () => {
    store.getState().setMode('approval');
    expect(store.getState().mode).toBe('approval');
  });

  it('sets phase info', () => {
    store.getState().setPhase({ current: 2, total: 4 });
    expect(store.getState().phase).toEqual({ current: 2, total: 4 });
  });

  it('initializes executionRequested as false', () => {
    expect(store.getState().executionRequested).toBe(false);
  });

  it('sets executionRequested via requestExecution', () => {
    store.getState().requestExecution();
    expect(store.getState().executionRequested).toBe(true);
  });

  it('requestExecution is idempotent', () => {
    store.getState().requestExecution();
    store.getState().requestExecution();
    expect(store.getState().executionRequested).toBe(true);
  });

  it('adopts the next queued placeholder into a live agent row', () => {
    store.getState().addAgent({ id: 'cp1', name: 'Resume checkpoint', feature: 'checkpoint', status: 'queued', removable: false });
    store.getState().addAgent({ id: 'queued-1', name: 'Queued request', feature: 'Queued request', status: 'queued', removable: true });
    store.getState().setFocusedAgent('queued-1');

    store.getState().adoptQueuedPlaceholder({
      id: '001',
      name: '001 Planned request',
      feature: 'Planned request'
    });

    expect(store.getState().agents.map((agent) => agent.id)).toEqual(['cp1', '001']);
    expect(store.getState().agents[1]).toMatchObject({
      id: '001',
      name: '001 Planned request',
      feature: 'Planned request',
      status: 'running',
      removable: false
    });
    expect(store.getState().focusedAgentId).toBe('001');
  });

  it('adds agent with custom status when provided', () => {
    store.getState().addAgent({ id: 'beta', name: 'Beta', feature: 'api', status: 'queued' });
    expect(store.getState().agents[0]?.status).toBe('queued');
  });

  it('adds agent with running status by default', () => {
    store.getState().addAgent({ id: 'gamma', name: 'Gamma', feature: 'auth' });
    expect(store.getState().agents[0]?.status).toBe('running');
  });

  it('removes agent and moves focus to next', () => {
    store.getState().addAgent({ id: 'a1', name: 'A1', feature: 'f1', status: 'queued' });
    store.getState().addAgent({ id: 'a2', name: 'A2', feature: 'f2', status: 'queued' });
    store.getState().addAgent({ id: 'a3', name: 'A3', feature: 'f3', status: 'queued' });
    store.getState().setFocusedAgent('a2');
    store.getState().removeAgent('a2');
    expect(store.getState().agents).toHaveLength(2);
    expect(store.getState().focusedAgentId).toBe('a3');
  });

  it('removes last agent and focuses previous', () => {
    store.getState().addAgent({ id: 'a1', name: 'A1', feature: 'f1', status: 'queued' });
    store.getState().addAgent({ id: 'a2', name: 'A2', feature: 'f2', status: 'queued' });
    store.getState().setFocusedAgent('a2');
    store.getState().removeAgent('a2');
    expect(store.getState().focusedAgentId).toBe('a1');
  });

  it('removes only agent and clears focus', () => {
    store.getState().addAgent({ id: 'a1', name: 'A1', feature: 'f1', status: 'queued' });
    store.getState().setFocusedAgent('a1');
    store.getState().removeAgent('a1');
    expect(store.getState().agents).toHaveLength(0);
    expect(store.getState().focusedAgentId).toBeNull();
  });

  it('initializes quitConfirmPending as false', () => {
    expect(store.getState().quitConfirmPending).toBe(false);
  });

  it('sets quitConfirmPending', () => {
    store.getState().setQuitConfirmPending(true);
    expect(store.getState().quitConfirmPending).toBe(true);
    store.getState().setQuitConfirmPending(false);
    expect(store.getState().quitConfirmPending).toBe(false);
  });

  it('initializes addInputText as null', () => {
    expect(store.getState().addInputText).toBeNull();
  });

  it('sets addInputText', () => {
    store.getState().setAddInputText('hello');
    expect(store.getState().addInputText).toBe('hello');
    store.getState().setAddInputText(null);
    expect(store.getState().addInputText).toBeNull();
  });

  it('advances spinner frame independently of agent status', () => {
    store.getState().tickSpinnerFrame();
    store.getState().tickSpinnerFrame();
    expect(store.getState().spinnerFrame).toBe(2);
  });

  it('stores completion summary state', () => {
    store.getState().setCompletion({ status: 'completed', plannedCount: 3, mergedCount: 2 });
    expect(store.getState().completion).toEqual({ status: 'completed', plannedCount: 3, mergedCount: 2 });
  });

  it('initializes completedFeatures as empty', () => {
    expect(store.getState().completedFeatures).toEqual([]);
  });

  it('sets completedFeatures', () => {
    store.getState().setCompletedFeatures([
      { id: 'feat-001', request: 'Add auth', mergeCommit: 'abc1234' },
      { id: 'feat-002', request: 'Add logging', mergeCommit: 'def5678' }
    ]);
    expect(store.getState().completedFeatures).toHaveLength(2);
    expect(store.getState().completedFeatures[0]).toEqual({
      id: 'feat-001', request: 'Add auth', mergeCommit: 'abc1234'
    });
  });

  it('replaces completedFeatures on subsequent set', () => {
    store.getState().setCompletedFeatures([
      { id: 'feat-001', request: 'Add auth', mergeCommit: null }
    ]);
    store.getState().setCompletedFeatures([
      { id: 'feat-001', request: 'Add auth', mergeCommit: 'abc1234' },
      { id: 'feat-002', request: 'Add logging', mergeCommit: 'def5678' }
    ]);
    expect(store.getState().completedFeatures).toHaveLength(2);
    expect(store.getState().completedFeatures[0]?.mergeCommit).toBe('abc1234');
  });

  it('initializes historyFocusedIndex at 0', () => {
    expect(store.getState().historyFocusedIndex).toBe(0);
  });

  it('sets historyFocusedIndex', () => {
    store.getState().setHistoryFocusedIndex(2);
    expect(store.getState().historyFocusedIndex).toBe(2);
  });

  it('initializes completionDismissed as false', () => {
    expect(store.getState().completionDismissed).toBe(false);
  });

  it('dismissCompletion sets completionDismissed', () => {
    store.getState().dismissCompletion();
    expect(store.getState().completionDismissed).toBe(true);
  });

  it('ticks elapsed only for running or approval agents', () => {
    store.getState().addAgent({ id: 'run', name: 'Run', feature: 'f1', status: 'running' });
    store.getState().addAgent({ id: 'approve', name: 'Approve', feature: 'f2', status: 'approval' });
    store.getState().addAgent({ id: 'done', name: 'Done', feature: 'f3', status: 'completed' });
    store.getState().tickAgentElapsed();

    const [runningAgent, approvalAgent, completedAgent] = store.getState().agents;
    expect(runningAgent?.elapsed).toBe(1);
    expect(approvalAgent?.elapsed).toBe(1);
    expect(completedAgent?.elapsed).toBe(0);
  });

  it('leaves the store unchanged when there is no queued placeholder to adopt', () => {
    store.getState().addAgent({ id: '001', name: 'Resume checkpoint', feature: 'checkpoint', status: 'queued', removable: false });

    store.getState().adoptQueuedPlaceholder({
      id: '002',
      name: '002 Planned request',
      feature: 'Planned request'
    });

    expect(store.getState().agents.map((agent) => agent.id)).toEqual(['001']);
    expect(store.getState().agents[0]).toMatchObject({
      id: '001',
      status: 'queued'
    });
  });

  it('adds agent with removable flag', () => {
    store.getState().addAgent({ id: 'a1', name: 'A1', feature: 'f1', removable: true });
    expect(store.getState().agents[0]?.removable).toBe(true);
  });

  it('defaults removable to false', () => {
    store.getState().addAgent({ id: 'a1', name: 'A1', feature: 'f1' });
    expect(store.getState().agents[0]?.removable).toBe(false);
  });

  it('addAgent initializes files and tokens to defaults', () => {
    store.getState().addAgent({ id: 'a1', name: 'A1', feature: 'f1' });
    const agent = store.getState().agents[0];
    expect(agent?.files).toEqual([]);
    expect(agent?.tokens).toBe(0);
  });

  it('addAgent accepts files in init', () => {
    store.getState().addAgent({ id: 'a1', name: 'A1', feature: 'f1', files: ['src/index.ts', 'src/app.ts'] });
    const agent = store.getState().agents[0];
    expect(agent?.files).toEqual(['src/index.ts', 'src/app.ts']);
  });

  it('updateAgent patches tokens', () => {
    store.getState().addAgent({ id: 'a1', name: 'A1', feature: 'f1' });
    store.getState().updateAgent('a1', { tokens: 1500 });
    expect(store.getState().agents[0]?.tokens).toBe(1500);
  });

  it('tracks totalTokens', () => {
    expect(store.getState().totalTokens).toBe(0);
    store.getState().setTotalTokens(42000);
    expect(store.getState().totalTokens).toBe(42000);
  });
});
