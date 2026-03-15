import { describe, it, expect } from 'vitest';
import { createUIStore } from '../../../src/ui/store.js';
import { createEventHandler } from '../../../src/ui/hooks/useOrchestratorBridge.js';

describe('createEventHandler', () => {
  it('handles agent:started by adding agent to store', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'agent:started', agentId: 'a1', name: 'Alpha', feature: 'auth' });
    expect(store.getState().agents).toHaveLength(1);
    expect(store.getState().agents[0]?.id).toBe('a1');
  });

  it('handles agent:text by appending output', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'agent:started', agentId: 'a1', name: 'Alpha', feature: 'auth' });
    handler({ type: 'agent:text', agentId: 'a1', text: 'Thinking...' });
    const agent = store.getState().agents[0];
    expect(agent?.outputLines).toHaveLength(1);
    expect(agent?.outputLines[0]?.type).toBe('text');
    expect(agent?.outputLines[0]?.content).toBe('Thinking...');
  });

  it('handles agent:tool-call by updating currentTool and appending output', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'agent:started', agentId: 'a1', name: 'Alpha', feature: 'auth' });
    handler({ type: 'agent:tool-call', agentId: 'a1', tool: 'read_file', args: 'src/index.ts' });
    const agent = store.getState().agents[0];
    expect(agent?.currentTool).toBe('read_file');
    expect(agent?.outputLines).toHaveLength(1);
    expect(agent?.outputLines[0]?.type).toBe('tool');
  });

  it('handles agent:completed by updating status and cost', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'agent:started', agentId: 'a1', name: 'Alpha', feature: 'auth' });
    handler({ type: 'agent:completed', agentId: 'a1', cost: 0.12 });
    const agent = store.getState().agents[0];
    expect(agent?.status).toBe('completed');
    expect(agent?.cost).toBe(0.12);
  });

  it('handles agent:approval by setting mode to approval', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'agent:started', agentId: 'a1', name: 'Alpha', feature: 'auth' });
    handler({
      type: 'agent:approval',
      agentId: 'a1',
      request: { file: 'src/index.ts', action: 'write', detail: 'Add auth import' },
    });
    expect(store.getState().mode).toBe('approval');
    const agent = store.getState().agents[0];
    expect(agent?.status).toBe('approval');
    expect(agent?.approvalRequest).not.toBeNull();
    expect(agent?.outputLines[0]?.meta).toEqual({
      file: 'src/index.ts',
      action: 'write',
      detail: 'Add auth import'
    });
  });

  it('handles phase:started by updating phase', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'phase:started', phase: 2, total: 4, featureIds: ['f1', 'f2'] });
    expect(store.getState().phase).toEqual({ current: 2, total: 4 });
  });

  it('handles phase:completed by clearing phase state', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'phase:started', phase: 2, total: 4, featureIds: ['f1', 'f2'] });
    handler({ type: 'phase:completed', phase: 2 });
    expect(store.getState().phase).toBeNull();
  });

  it('handles session:cost-update by updating totalCost', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'session:cost-update', totalCost: 1.50 });
    expect(store.getState().totalCost).toBe(1.50);
  });
});
