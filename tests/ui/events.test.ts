import { describe, it, expect } from 'vitest';
import type { OrchestratorEvent } from '../../src/ui/events.js';

describe('OrchestratorEvent', () => {
  it('narrows agent:started events', () => {
    const event: OrchestratorEvent = {
      type: 'agent:started',
      agentId: 'alpha',
      name: 'Alpha',
      feature: 'auth-system',
      stage: 'execution',
    };
    if (event.type === 'agent:started') {
      expect(event.agentId).toBe('alpha');
      expect(event.name).toBe('Alpha');
      expect(event.feature).toBe('auth-system');
    }
  });

  it('narrows agent:text events', () => {
    const event: OrchestratorEvent = {
      type: 'agent:text',
      agentId: 'alpha',
      text: 'Thinking about auth...',
      stage: 'execution',
    };
    if (event.type === 'agent:text') {
      expect(event.text).toBe('Thinking about auth...');
    }
  });

  it('narrows agent:tool-call events', () => {
    const event: OrchestratorEvent = {
      type: 'agent:tool-call',
      agentId: 'alpha',
      tool: 'read_file',
      args: 'src/index.ts',
    };
    if (event.type === 'agent:tool-call') {
      expect(event.tool).toBe('read_file');
    }
  });

  it('narrows phase:started events', () => {
    const event: OrchestratorEvent = {
      type: 'phase:started',
      phase: 2,
      total: 4,
      featureIds: ['f001', 'f002'],
    };
    if (event.type === 'phase:started') {
      expect(event.featureIds).toHaveLength(2);
    }
  });

  it('narrows phase:re-analyzing events', () => {
    const event: OrchestratorEvent = {
      type: 'phase:re-analyzing',
      phase: 2,
      total: 4,
    };
    if (event.type === 'phase:re-analyzing') {
      expect(event.total).toBe(4);
    }
  });
});
