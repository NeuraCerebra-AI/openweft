import { describe, it, expect } from 'vitest';
import { createUIStore } from '../../../src/ui/store.js';
import { createEventHandler } from '../../../src/ui/hooks/useOrchestratorBridge.js';

describe('createEventHandler', () => {
  it('handles agent:started by adding agent to store', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'agent:started', agentId: 'a1', name: 'Alpha', feature: 'auth', stage: 'execution' });
    expect(store.getState().agents).toHaveLength(1);
    expect(store.getState().agents[0]?.id).toBe('a1');
  });

  it('handles agent:text by appending output', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'agent:started', agentId: 'a1', name: 'Alpha', feature: 'auth', stage: 'execution' });
    handler({ type: 'agent:text', agentId: 'a1', text: 'Thinking...', stage: 'execution' });
    const agent = store.getState().agents[0];
    expect(agent?.outputLines).toHaveLength(1);
    expect(agent?.outputLines[0]?.type).toBe('text');
    expect(agent?.outputLines[0]?.content).toBe('Thinking...');
  });

  it('handles agent:tool-call by updating currentTool and appending output', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'agent:started', agentId: 'a1', name: 'Alpha', feature: 'auth', stage: 'execution' });
    handler({ type: 'agent:tool-call', agentId: 'a1', tool: 'read_file', args: 'src/index.ts' });
    const agent = store.getState().agents[0];
    expect(agent?.currentTool).toBe('read_file');
    expect(agent?.outputLines).toHaveLength(1);
    expect(agent?.outputLines[0]?.type).toBe('tool');
  });

  it('handles agent:completed by updating status and cost', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'agent:started', agentId: 'a1', name: 'Alpha', feature: 'auth', stage: 'execution' });
    handler({ type: 'agent:completed', agentId: 'a1', cost: 0.12 });
    const agent = store.getState().agents[0];
    expect(agent?.status).toBe('completed');
    expect(agent?.cost).toBe(0.12);
  });

  it('handles agent:approval by setting mode to approval', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'agent:started', agentId: 'a1', name: 'Alpha', feature: 'auth', stage: 'execution' });
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

  it('handles phase:re-analyzing by showing an intermediate phase label', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'phase:re-analyzing', phase: 2, total: 4 });
    expect(store.getState().phase).toEqual({
      current: 2,
      total: 4,
      label: 'Re-analyzing after phase 2/4'
    });
  });

  it('handles session:cost-update by updating totalCost', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({ type: 'session:cost-update', totalCost: 1.50 });
    expect(store.getState().totalCost).toBe(1.50);
  });

  it('adopts the next queued placeholder when a planning stage 1 agent appears', () => {
    const store = createUIStore();
    store.getState().addAgent({
      id: 'queued-1',
      name: 'Queued request',
      feature: 'Queued request',
      status: 'queued',
      removable: true
    });
    const handler = createEventHandler(store);

    handler({ type: 'agent:started', agentId: '001', name: '001 Alpha', feature: 'Alpha', stage: 'planning-s1' });

    expect(store.getState().agents).toHaveLength(1);
    expect(store.getState().agents[0]).toMatchObject({
      id: '001',
      name: '001 Alpha',
      feature: 'Alpha',
      status: 'running',
      removable: false
    });
  });

  it('session:token-update sets agent tokens and totalTokens', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({
      type: 'agent:started',
      agentId: 'a1',
      name: 'test',
      feature: 'feat',
      stage: 'execution',
    });
    handler({
      type: 'session:token-update',
      agentId: 'a1',
      tokens: 8400,
      totalTokens: 14200,
    });
    expect(store.getState().agents[0]!.tokens).toBe(8400);
    expect(store.getState().totalTokens).toBe(14200);
  });

  it('agent:started passes files to addAgent', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);
    handler({
      type: 'agent:started',
      agentId: 'a1',
      name: 'test',
      feature: 'feat',
      stage: 'execution',
      files: ['src/a.ts', 'src/b.ts'],
    });
    expect(store.getState().agents[0]!.files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('replaces raw planning output with a stage-aware summary', () => {
    const store = createUIStore();
    const handler = createEventHandler(store);

    handler({ type: 'agent:started', agentId: '001', name: '001 Alpha', feature: 'Alpha', stage: 'planning-s1' });
    handler({
      type: 'agent:text',
      agentId: '001',
      stage: 'planning-s1',
      text: 'Runtime-generated Prompt B for 001'
    });

    const agent = store.getState().agents[0];
    expect(agent?.outputLines[0]?.content).toContain('Planning stage 1');
    expect(agent?.outputLines[0]?.content).not.toContain('Prompt B');
  });
});
