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
  readonly files: readonly string[];
  readonly tokens: number;
  readonly approvalRequest: ApprovalRequest | null;
}

export interface CompletedFeature {
  readonly id: string;
  readonly request: string;
  readonly mergeCommit: string | null;
}

export type UIMode = 'normal' | 'approval' | 'input' | 'history' | 'history-detail';

export interface UIStore {
  phase: { current: number; total: number; label?: string } | null;
  totalCost: number;
  totalTokens: number;
  elapsed: number;
  spinnerFrame: number;
  completion: {
    status: string;
    plannedCount: number;
    mergedCount: number;
  } | null;
  completionDismissed: boolean;
  completedFeatures: readonly CompletedFeature[];
  historyFocusedIndex: number;
  notice: { level: 'info' | 'error'; message: string } | null;
  agents: AgentState[];
  focusedAgentId: string | null;
  mode: UIMode;
  filterText: string;
  filterCursorOffset: number;
  showHelp: boolean;
  executionRequested: boolean;
  quitConfirmPending: boolean;
  addInputText: string | null;
  addInputCursorOffset: number;
  addAgent: (init: { id: string; name: string; feature: string; status?: AgentStatus; removable?: boolean; files?: readonly string[] }) => void;
  removeAgent: (id: string) => void;
  updateAgent: (id: string, patch: Partial<Pick<AgentState, 'status' | 'cost' | 'elapsed' | 'currentTool' | 'approvalRequest' | 'tokens'>>) => void;
  appendOutput: (agentId: string, line: OutputLine) => void;
  setFocusedAgent: (id: string | null) => void;
  setMode: (mode: UIMode) => void;
  setPhase: (phase: { current: number; total: number; label?: string } | null) => void;
  setTotalCost: (cost: number) => void;
  setTotalTokens: (tokens: number) => void;
  setElapsed: (elapsed: number) => void;
  tickAgentElapsed: () => void;
  tickSpinnerFrame: () => void;
  setCompletion: (completion: UIStore['completion']) => void;
  setCompletedFeatures: (features: readonly CompletedFeature[]) => void;
  setHistoryFocusedIndex: (index: number) => void;
  dismissCompletion: () => void;
  setShowHelp: (show: boolean) => void;
  setFilterText: (text: string) => void;
  setFilterCursorOffset: (offset: number) => void;
  setNotice: (notice: UIStore['notice']) => void;
  requestExecution: () => void;
  setQuitConfirmPending: (pending: boolean) => void;
  setAddInputText: (text: string | null) => void;
  setAddInputCursorOffset: (offset: number) => void;
  adoptQueuedPlaceholder: (agent: { id: string; name: string; feature: string }) => boolean;
}

const isQueuedPlaceholder = (agent: AgentState): boolean =>
  agent.status === 'queued' && agent.id.startsWith('queued');

export const createUIStore = () =>
  createStore<UIStore>((set) => ({
    phase: null,
    totalCost: 0,
    totalTokens: 0,
    elapsed: 0,
    spinnerFrame: 0,
    completion: null,
    completionDismissed: false,
    completedFeatures: [],
    historyFocusedIndex: 0,
    notice: null,
    agents: [],
    focusedAgentId: null,
    mode: 'normal',
    filterText: '',
    filterCursorOffset: 0,
    showHelp: false,
    executionRequested: false,
    quitConfirmPending: false,
    addInputText: null,
    addInputCursorOffset: 0,

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
            files: init.files ?? [],
            tokens: 0,
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
        return { agents: filtered, focusedAgentId: nextFocused };
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

    setFocusedAgent: (id) => set({ focusedAgentId: id }),
    setMode: (mode) => set({ mode }),
    setPhase: (phase) => set({ phase }),
    setTotalCost: (cost) => set({ totalCost: cost }),
    setTotalTokens: (tokens) => set({ totalTokens: tokens }),
    setElapsed: (elapsed) => set({ elapsed }),
    tickAgentElapsed: () =>
      set((state) => ({
        agents: state.agents.map((agent) =>
          agent.status === 'running' || agent.status === 'approval'
            ? { ...agent, elapsed: agent.elapsed + 1 }
            : agent
        )
      })),
    tickSpinnerFrame: () => set((state) => ({ spinnerFrame: state.spinnerFrame + 1 })),
    setCompletion: (completion) => set({ completion }),
    setCompletedFeatures: (features) => set((state) => ({
      completedFeatures: features,
      historyFocusedIndex: Math.min(state.historyFocusedIndex, Math.max(0, features.length - 1)),
    })),
    setHistoryFocusedIndex: (index) => set({ historyFocusedIndex: index }),
    dismissCompletion: () => set({ completionDismissed: true }),
    setShowHelp: (show) => set({ showHelp: show }),
    setFilterText: (text) => set({ filterText: text, filterCursorOffset: text.length }),
    setFilterCursorOffset: (offset) =>
      set((state) => ({ filterCursorOffset: Math.max(0, Math.min(offset, state.filterText.length)) })),
    setNotice: (notice) => set({ notice }),
    requestExecution: () => set({ executionRequested: true }),
    setQuitConfirmPending: (pending) => set({ quitConfirmPending: pending }),
    setAddInputText: (text) => set({ addInputText: text, addInputCursorOffset: text?.length ?? 0 }),
    setAddInputCursorOffset: (offset) =>
      set((state) => ({
        addInputCursorOffset: Math.max(0, Math.min(offset, state.addInputText?.length ?? 0)),
      })),
    adoptQueuedPlaceholder: (agent) => {
      let adopted = false;

      set((state) => {
        const placeholderIndex = state.agents.findIndex(isQueuedPlaceholder);
        if (placeholderIndex === -1) {
          return state;
        }

        adopted = true;
        const placeholder = state.agents[placeholderIndex];
        if (!placeholder) {
          return state;
        }

        const nextAgents = [...state.agents];
        nextAgents[placeholderIndex] = {
          ...placeholder,
          id: agent.id,
          name: agent.name,
          feature: agent.feature,
          status: 'running',
          removable: false,
          currentTool: null,
          approvalRequest: null
        };

        const focusedAgentId = state.focusedAgentId === placeholder.id ? agent.id : state.focusedAgentId;

        return {
          agents: nextAgents,
          focusedAgentId
        };
      });

      return adopted;
    },
  }));
