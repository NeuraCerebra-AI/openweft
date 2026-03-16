import { createStore } from 'zustand/vanilla';

import type { ApprovalRequest } from './events.js';

const MAX_OUTPUT_LINES = 5000;

export type AgentStatus = 'running' | 'completed' | 'failed' | 'queued' | 'approval';

export interface OutputLine {
  readonly type: 'text' | 'tool' | 'tool-result' | 'code' | 'approval';
  readonly content: string;
  readonly timestamp: number;
  readonly meta?: Record<string, string>;
}

export interface AgentState {
  readonly id: string;
  readonly name: string;
  readonly feature: string;
  readonly status: AgentStatus;
  readonly removable: boolean;
  readonly currentTool: string | null;
  readonly cost: number;
  readonly elapsed: number;
  readonly outputLines: OutputLine[];
  readonly approvalRequest: ApprovalRequest | null;
}

export interface UIStore {
  phase: { current: number; total: number } | null;
  totalCost: number;
  elapsed: number;
  notice: { level: 'info' | 'error'; message: string } | null;
  agents: AgentState[];
  focusedAgentId: string | null;
  mode: 'normal' | 'approval' | 'input';
  sidebarFocused: boolean;
  filterText: string;
  scrollOffset: number;
  showHelp: boolean;
  executionRequested: boolean;
  quitConfirmPending: boolean;
  addInputText: string | null;
  addAgent: (init: { id: string; name: string; feature: string; status?: AgentStatus; removable?: boolean }) => void;
  removeAgent: (id: string) => void;
  updateAgent: (id: string, patch: Partial<Pick<AgentState, 'status' | 'cost' | 'elapsed' | 'currentTool' | 'approvalRequest'>>) => void;
  appendOutput: (agentId: string, line: OutputLine) => void;
  setFocusedAgent: (id: string | null) => void;
  setMode: (mode: UIStore['mode']) => void;
  togglePanel: () => void;
  setPhase: (phase: { current: number; total: number } | null) => void;
  setTotalCost: (cost: number) => void;
  setElapsed: (elapsed: number) => void;
  tickAgentElapsed: () => void;
  setScrollOffset: (offset: number) => void;
  setShowHelp: (show: boolean) => void;
  setFilterText: (text: string) => void;
  setNotice: (notice: UIStore['notice']) => void;
  requestExecution: () => void;
  setQuitConfirmPending: (pending: boolean) => void;
  setAddInputText: (text: string | null) => void;
  clearQueuedAgents: () => void;
}

export const createUIStore = () =>
  createStore<UIStore>((set) => ({
    phase: null,
    totalCost: 0,
    elapsed: 0,
    notice: null,
    agents: [],
    focusedAgentId: null,
    mode: 'normal',
    sidebarFocused: true,
    filterText: '',
    scrollOffset: 0,
    showHelp: false,
    executionRequested: false,
    quitConfirmPending: false,
    addInputText: null,

    addAgent: (init) =>
      set((state) => ({
        agents: [
          ...state.agents,
          {
            ...init,
            status: init.status ?? ('running' as const),
            removable: init.removable ?? false,
            currentTool: null,
            cost: 0,
            elapsed: 0,
            outputLines: [],
            approvalRequest: null,
          },
        ],
      })),

    removeAgent: (id) =>
      set((state) => {
        const filtered = state.agents.filter((a) => a.id !== id);
        let nextFocused = state.focusedAgentId;
        if (state.focusedAgentId === id) {
          const idx = state.agents.findIndex((a) => a.id === id);
          const next = filtered[idx] ?? filtered[idx - 1] ?? null;
          nextFocused = next?.id ?? null;
        }
        return { agents: filtered, focusedAgentId: nextFocused, scrollOffset: 0 };
      }),

    updateAgent: (id, patch) =>
      set((state) => ({
        agents: state.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      })),

    appendOutput: (agentId, line) =>
      set((state) => ({
        agents: state.agents.map((a) => {
          if (a.id !== agentId) return a;
          const lines = [...a.outputLines, line];
          return {
            ...a,
            outputLines: lines.length > MAX_OUTPUT_LINES ? lines.slice(-MAX_OUTPUT_LINES) : lines,
          };
        }),
      })),

    setFocusedAgent: (id) => set({ focusedAgentId: id, scrollOffset: 0 }),
    setMode: (mode) => set({ mode }),
    togglePanel: () => set((state) => ({ sidebarFocused: !state.sidebarFocused })),
    setPhase: (phase) => set({ phase }),
    setTotalCost: (cost) => set({ totalCost: cost }),
    setElapsed: (elapsed) => set({ elapsed }),
    tickAgentElapsed: () =>
      set((state) => ({
        agents: state.agents.map((agent) =>
          agent.status === 'running' || agent.status === 'approval'
            ? { ...agent, elapsed: agent.elapsed + 1 }
            : agent
        )
      })),
    setScrollOffset: (offset) => set({ scrollOffset: offset }),
    setShowHelp: (show) => set({ showHelp: show }),
    setFilterText: (text) => set({ filterText: text }),
    setNotice: (notice) => set({ notice }),
    requestExecution: () => set({ executionRequested: true }),
    setQuitConfirmPending: (pending) => set({ quitConfirmPending: pending }),
    setAddInputText: (text) => set({ addInputText: text }),
    clearQueuedAgents: () =>
      set((state) => {
        const filtered = state.agents.filter((a) => a.status !== 'queued');
        const focusStillExists = filtered.some((a) => a.id === state.focusedAgentId);
        return {
          agents: filtered,
          focusedAgentId: focusStillExists ? state.focusedAgentId : (filtered[0]?.id ?? null),
          scrollOffset: 0,
        };
      }),
  }));
