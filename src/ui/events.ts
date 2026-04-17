type AgentStage = 'planning-s1' | 'planning-s2' | 'execution' | 'adjustment' | 'conflict-resolution';

export interface ApprovalRequest {
  readonly file: string;
  readonly action: string;
  readonly detail: string;
}

export type OrchestratorEvent =
  | {
      readonly type: 'agent:started';
      readonly agentId: string;
      readonly name: string;
      readonly feature: string;
      readonly stage: AgentStage;
      readonly files?: readonly string[];
    }
  | { readonly type: 'agent:text'; readonly agentId: string; readonly text: string; readonly stage: AgentStage }
  | { readonly type: 'agent:tool-call'; readonly agentId: string; readonly tool: string; readonly args: string; readonly result?: string }
  | { readonly type: 'agent:tool-result'; readonly agentId: string; readonly tool: string; readonly result: string; readonly success: boolean }
  | { readonly type: 'agent:code-block'; readonly agentId: string; readonly filename: string; readonly content: string; readonly language: string }
  | { readonly type: 'agent:approval'; readonly agentId: string; readonly request: ApprovalRequest }
  | { readonly type: 'agent:approval-resolved'; readonly agentId: string; readonly decision: 'approve' | 'deny' | 'skip' }
  | { readonly type: 'agent:completed'; readonly agentId: string }
  | { readonly type: 'agent:failed'; readonly agentId: string; readonly error: string }
  | { readonly type: 'phase:started'; readonly phase: number; readonly total: number; readonly featureIds: string[] }
  | { readonly type: 'phase:re-analyzing'; readonly phase: number; readonly total: number }
  | { readonly type: 'phase:completed'; readonly phase: number }
  | { readonly type: 'session:token-update'; readonly agentId: string; readonly tokens: number; readonly totalTokens: number };

export type OrchestratorEventHandler = (event: OrchestratorEvent) => void;
