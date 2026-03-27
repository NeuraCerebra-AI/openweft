import { describe, expect, it } from 'vitest';

import { ApprovalController } from '../../src/orchestrator/approval.js';
import type { OrchestratorEvent } from '../../src/ui/events.js';

describe('ApprovalController', () => {
  it('queues approvals and emits one active request at a time', async () => {
    const events: OrchestratorEvent[] = [];
    const controller = new ApprovalController((event) => {
      events.push(event);
    });

    const first = controller.requestApproval({
      agentId: '001',
      request: { file: 'src/a.ts', action: 'write', detail: 'change A' }
    });
    const second = controller.requestApproval({
      agentId: '002',
      request: { file: 'src/b.ts', action: 'write', detail: 'change B' }
    });

    expect(events).toEqual([
      {
        type: 'agent:approval',
        agentId: '001',
        request: { file: 'src/a.ts', action: 'write', detail: 'change A' }
      }
    ]);

    expect(controller.resolveCurrent('approve')).toBe(true);
    await expect(first).resolves.toBe('approve');
    expect(events).toEqual([
      {
        type: 'agent:approval',
        agentId: '001',
        request: { file: 'src/a.ts', action: 'write', detail: 'change A' }
      },
      {
        type: 'agent:approval-resolved',
        agentId: '001',
        decision: 'approve'
      },
      {
        type: 'agent:approval',
        agentId: '002',
        request: { file: 'src/b.ts', action: 'write', detail: 'change B' }
      }
    ]);

    expect(controller.resolveCurrent('skip')).toBe(true);
    await expect(second).resolves.toBe('skip');
  });

  it('supports approve-always for future requests', async () => {
    const events: OrchestratorEvent[] = [];
    const controller = new ApprovalController((event) => {
      events.push(event);
    });

    const first = controller.requestApproval({
      agentId: '001',
      request: { file: 'src/a.ts', action: 'write', detail: 'change A' }
    });
    expect(controller.resolveCurrent('always')).toBe(true);
    await expect(first).resolves.toBe('approve');

    await expect(controller.requestApproval({
      agentId: '002',
      request: { file: 'src/b.ts', action: 'write', detail: 'change B' }
    })).resolves.toBe('approve');

    expect(events).toEqual([
      {
        type: 'agent:approval',
        agentId: '001',
        request: { file: 'src/a.ts', action: 'write', detail: 'change A' }
      },
      {
        type: 'agent:approval-resolved',
        agentId: '001',
        decision: 'approve'
      }
    ]);
  });

  it('can flush active and queued approvals during shutdown', async () => {
    const events: OrchestratorEvent[] = [];
    const controller = new ApprovalController((event) => {
      events.push(event);
    });

    const first = controller.requestApproval({
      agentId: '001',
      request: { file: 'src/a.ts', action: 'write', detail: 'change A' }
    });
    const second = controller.requestApproval({
      agentId: '002',
      request: { file: 'src/b.ts', action: 'write', detail: 'change B' }
    });

    expect(controller.resolveAll('skip')).toBe(2);
    await expect(first).resolves.toBe('skip');
    await expect(second).resolves.toBe('skip');

    expect(events).toEqual([
      {
        type: 'agent:approval',
        agentId: '001',
        request: { file: 'src/a.ts', action: 'write', detail: 'change A' }
      },
      {
        type: 'agent:approval-resolved',
        agentId: '001',
        decision: 'skip'
      }
    ]);
  });
});
