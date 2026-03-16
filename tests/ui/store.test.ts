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
    expect(state.sidebarFocused).toBe(true);
    expect(state.phase).toBeNull();
    expect(state.totalCost).toBe(0);
    expect(state.scrollOffset).toBe(0);
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

  it('toggles panel focus', () => {
    expect(store.getState().sidebarFocused).toBe(true);
    store.getState().togglePanel();
    expect(store.getState().sidebarFocused).toBe(false);
    store.getState().togglePanel();
    expect(store.getState().sidebarFocused).toBe(true);
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

  it('clears queued agents', () => {
    store.getState().addAgent({ id: 'q1', name: 'Q1', feature: 'f1', status: 'queued' });
    store.getState().addAgent({ id: 'r1', name: 'R1', feature: 'f2', status: 'running' });
    store.getState().addAgent({ id: 'q2', name: 'Q2', feature: 'f3', status: 'queued' });
    store.getState().setFocusedAgent('q1');
    store.getState().clearQueuedAgents();
    expect(store.getState().agents).toHaveLength(1);
    expect(store.getState().agents[0]?.id).toBe('r1');
    expect(store.getState().focusedAgentId).toBe('r1');
  });

  it('adds agent with removable flag', () => {
    store.getState().addAgent({ id: 'a1', name: 'A1', feature: 'f1', removable: true });
    expect(store.getState().agents[0]?.removable).toBe(true);
  });

  it('defaults removable to false', () => {
    store.getState().addAgent({ id: 'a1', name: 'A1', feature: 'f1' });
    expect(store.getState().agents[0]?.removable).toBe(false);
  });
});
