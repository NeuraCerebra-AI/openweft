import type { StoreApi } from 'zustand/vanilla';

import type { OrchestratorEvent, OrchestratorEventHandler } from '../events.js';
import type { UIStore } from '../store.js';

const getPlanningSummary = (stage: Extract<OrchestratorEvent, { type: 'agent:text' }>['stage']): string | null => {
  switch (stage) {
    case 'planning-s1':
      return 'Planning stage 1 complete: prepared the implementation prompt.';
    case 'planning-s2':
      return 'Planning stage 2 complete: generated the feature plan.';
    default:
      return null;
  }
};

export const createEventHandler = (store: StoreApi<UIStore>): OrchestratorEventHandler => {
  return (event: OrchestratorEvent): void => {
    const { getState } = store;
    const now = Date.now();

    switch (event.type) {
      case 'agent:started': {
        const alreadyExists = getState().agents.some((agent) => agent.id === event.agentId);
        if (alreadyExists) {
          getState().updateAgent(event.agentId, {
            status: 'running',
            currentTool: null,
            approvalRequest: null
          });
        } else {
          const adoptedPlaceholder = event.stage === 'planning-s1'
            ? getState().adoptQueuedPlaceholder({
                id: event.agentId,
                name: event.name,
                feature: event.feature
              })
            : false;

          if (!adoptedPlaceholder) {
            getState().addAgent({
              id: event.agentId,
              name: event.name,
              feature: event.feature,
              ...(event.files ? { files: [...event.files] } : {}),
            });
          }
        }
        if (getState().focusedAgentId === null) {
          getState().setFocusedAgent(event.agentId);
        }
        break;
      }

      case 'agent:text': {
        const planningSummary = getPlanningSummary(event.stage);
        getState().appendOutput(event.agentId, {
          type: 'text',
          content: planningSummary ?? event.text,
          timestamp: now
        });
        break;
      }

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
          meta: {
            file: event.request.file,
            action: event.request.action,
            detail: event.request.detail
          }
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
        getState().updateAgent(event.agentId, { status: 'completed', currentTool: null });
        break;

      case 'agent:failed':
        getState().updateAgent(event.agentId, { status: 'failed', currentTool: null });
        getState().appendOutput(event.agentId, { type: 'text', content: `Error: ${event.error}`, timestamp: now });
        break;

      case 'phase:started':
        getState().setPhase({ current: event.phase, total: event.total });
        break;

      case 'phase:re-analyzing':
        getState().setPhase({
          current: event.phase,
          total: event.total,
          label: `Re-analyzing after phase ${event.phase}/${event.total}`
        });
        break;

      case 'phase:completed':
        getState().setPhase(null);
        break;

      case 'session:token-update':
        getState().updateAgent(event.agentId, { tokens: event.tokens });
        getState().setTotalTokens(event.totalTokens);
        break;

      default: {
        const _exhaustive: never = event;
        void _exhaustive;
      }
    }
  };
};
