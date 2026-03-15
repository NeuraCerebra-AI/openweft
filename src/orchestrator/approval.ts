import type { ApprovalRequest, OrchestratorEventHandler } from '../ui/events.js';

export type ApprovalResolution = 'approve' | 'deny' | 'skip' | 'always';
export type ApprovalDecision = 'approve' | 'deny' | 'skip';

interface ApprovalQueueItem {
  readonly agentId: string;
  readonly request: ApprovalRequest;
  readonly resolve: (decision: ApprovalDecision) => void;
}

export class TurnApprovalError extends Error {
  constructor(
    readonly agentId: string,
    readonly stage: string,
    readonly decision: Exclude<ApprovalDecision, 'approve'>
  ) {
    const verb = decision === 'deny' ? 'denied' : 'skipped';
    super(`User ${verb} ${stage} for feature ${agentId}.`);
    this.name = 'TurnApprovalError';
  }
}

export class ApprovalController {
  private readonly queue: ApprovalQueueItem[] = [];

  private active: ApprovalQueueItem | null = null;

  private autoApprove = false;

  constructor(private readonly onEvent?: OrchestratorEventHandler) {}

  async requestApproval(input: {
    agentId: string;
    request: ApprovalRequest;
  }): Promise<ApprovalDecision> {
    if (this.autoApprove) {
      return 'approve';
    }

    return new Promise<ApprovalDecision>((resolve) => {
      this.queue.push({
        agentId: input.agentId,
        request: input.request,
        resolve
      });
      this.pump();
    });
  }

  resolveCurrent(decision: ApprovalResolution): boolean {
    const current = this.active;
    if (!current) {
      return false;
    }

    this.active = null;
    if (decision === 'always') {
      this.autoApprove = true;
    }

    const resolvedDecision = decision === 'always' ? 'approve' : decision;
    this.onEvent?.({
      type: 'agent:approval-resolved',
      agentId: current.agentId,
      decision: resolvedDecision
    });
    current.resolve(resolvedDecision);
    this.pump();
    return true;
  }

  resolveAll(decision: Exclude<ApprovalDecision, 'approve'>): number {
    let resolvedCount = 0;

    if (this.active) {
      const current = this.active;
      this.active = null;
      this.onEvent?.({
        type: 'agent:approval-resolved',
        agentId: current.agentId,
        decision
      });
      current.resolve(decision);
      resolvedCount += 1;
    }

    for (const queued of this.queue.splice(0)) {
      queued.resolve(decision);
      resolvedCount += 1;
    }

    return resolvedCount;
  }

  hasPendingApproval(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  private pump(): void {
    if (this.active !== null) {
      return;
    }

    const next = this.queue.shift();
    if (!next) {
      return;
    }

    this.active = next;
    this.onEvent?.({
      type: 'agent:approval',
      agentId: next.agentId,
      request: next.request
    });
  }
}
