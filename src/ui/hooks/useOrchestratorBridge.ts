import type { StoreApi } from 'zustand/vanilla';

import type { OrchestratorEvent, OrchestratorEventHandler } from '../events.js';
import type { UIStore } from '../store.js';

export const createEventHandler = (store: StoreApi<UIStore>): OrchestratorEventHandler => {
  return (event: OrchestratorEvent): void => {
    const { getState } = store;
    const now = Date.now();

    switch (event.type) {
      case 'agent:started':
        getState().addAgent({ id: event.agentId, name: event.name, feature: event.feature });
        if (getState().focusedAgentId === null) {
          getState().setFocusedAgent(event.agentId);
        }
        break;

      case 'agent:text':
        getState().appendOutput(event.agentId, { type: 'text', content: event.text, timestamp: now });
        break;

      case 'agent:tool-call':
        getState().updateAgent(event.agentId, { currentTool: event.tool });
        getState().appendOutput(event.agentId, {
          type: 'tool',
          content: `${event.tool} ${event.args}`,
          timestamp: now,
          meta: { tool: event.tool, args: event.args },
        });
        break;

      case 'agent:tool-result':
        getState().updateAgent(event.agentId, { currentTool: null });
        getState().appendOutput(event.agentId, {
          type: 'tool-result',
          content: event.result,
          timestamp: now,
          meta: { tool: event.tool, success: String(event.success) },
        });
        break;

      case 'agent:code-block':
        getState().appendOutput(event.agentId, {
          type: 'code',
          content: event.content,
          timestamp: now,
          meta: { filename: event.filename, language: event.language },
        });
        break;

      case 'agent:approval':
        getState().updateAgent(event.agentId, {
          status: 'approval',
          approvalRequest: event.request,
        });
        getState().appendOutput(event.agentId, {
          type: 'approval',
          content: `${event.request.action}: ${event.request.file}`,
          timestamp: now,
        });
        getState().setMode('approval');
        getState().setFocusedAgent(event.agentId);
        break;

      case 'agent:approval-resolved':
        getState().updateAgent(event.agentId, {
          status: 'running',
          approvalRequest: null,
        });
        getState().setMode('normal');
        break;

      case 'agent:completed':
        getState().updateAgent(event.agentId, { status: 'completed', cost: event.cost, currentTool: null });
        break;

      case 'agent:failed':
        getState().updateAgent(event.agentId, { status: 'failed', currentTool: null });
        getState().appendOutput(event.agentId, { type: 'text', content: `Error: ${event.error}`, timestamp: now });
        break;

      case 'phase:started':
        getState().setPhase({ current: event.phase, total: event.total });
        break;

      case 'phase:completed':
        break;

      case 'session:cost-update':
        getState().setTotalCost(event.totalCost);
        break;
    }
  };
};
