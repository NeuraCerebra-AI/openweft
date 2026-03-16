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
  addAgent: (init: { id: string; name: string; feature: string; status?: AgentStatus }) => void;
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

    addAgent: (init) =>
      set((state) => ({
        agents: [
          ...state.agents,
          {
            ...init,
            status: init.status ?? ('running' as const),
            currentTool: null,
            cost: 0,
            elapsed: 0,
            outputLines: [],
            approvalRequest: null,
          },
        ],
      })),

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
  }));
