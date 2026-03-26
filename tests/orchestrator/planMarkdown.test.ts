import { describe, expect, it } from 'vitest';

import { repairPlanMarkdownIfNeeded } from '../../src/orchestrator/planMarkdown.js';

const validPlan = `# Plan

## Ledger

### Constraints
- Keep the change set small.

### Assumptions
- The manifest is conservative.

### Watchpoints
- Preserve runtime compatibility.

### Validation
- Run targeted tests.

## Manifest

\`\`\`json manifest
{
  "create": [],
  "modify": ["src/app.ts"],
  "delete": []
}
\`\`\`
`;

describe('planMarkdown', () => {
  it('includes validator error, rejected markdown, and prompt b context in the first repair prompt', async () => {
    const prompts: string[] = [];

    const repaired = await repairPlanMarkdownIfNeeded({
      featureId: '001',
      request: 'add auth',
      initialMarkdown: '# Summary only\n',
      shadowMarkdown: null,
      promptBMarkdown: '# 1. Role\n\nYou are implementing auth.\n',
      runRepairTurn: async (prompt) => {
        prompts.push(prompt);
        return {
          ok: true,
          finalMessage: validPlan,
          sessionId: 'repair-1'
        };
      }
    });

    expect(repaired.sessionId).toBe('repair-1');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(
      'Previous validation error: No ledger section found under a "## Ledger" heading.'
    );
    expect(prompts[0]).toContain('=== REJECTED PLAN MARKDOWN START ===');
    expect(prompts[0]).toContain('# Summary only');
    expect(prompts[0]).toContain('=== PROMPT B START ===');
    expect(prompts[0]).toContain('# 1. Role');
  });

  it('carries forward the latest validator error and rejected markdown across repair attempts', async () => {
    const prompts: string[] = [];
    let attempts = 0;

    const repaired = await repairPlanMarkdownIfNeeded({
      featureId: '001',
      request: 'add auth',
      initialMarkdown: '# Summary only\n',
      shadowMarkdown: null,
      promptBMarkdown: '# 1. Role\n\nYou are implementing auth.\n',
      runRepairTurn: async (prompt) => {
        prompts.push(prompt);
        attempts += 1;

        if (attempts === 1) {
          return {
            ok: true,
            finalMessage: `# Repair attempt 1

## Ledger

### Constraints
- Keep the change set small.

### Assumptions
- The manifest is conservative.

### Watchpoints
- Preserve runtime compatibility.

### Validation
- Run targeted tests.
`,
            sessionId: 'repair-1'
          };
        }

        return {
          ok: true,
          finalMessage: validPlan,
          sessionId: 'repair-2'
        };
      }
    });

    expect(repaired.sessionId).toBe('repair-2');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(
      'Previous validation error: No manifest block found under a "## Manifest" heading.'
    );
    expect(prompts[1]).toContain('=== REJECTED PLAN MARKDOWN START ===');
    expect(prompts[1]).toContain('# Repair attempt 1');
  });

  it('surfaces the last validation error instead of defaulting to a summary guess when repairs are exhausted', async () => {
    await expect(
      repairPlanMarkdownIfNeeded({
        featureId: '001',
        request: 'add auth',
        initialMarkdown: '# Summary only\n',
        shadowMarkdown: null,
        promptBMarkdown: '# 1. Role\n\nYou are implementing auth.\n',
        runRepairTurn: async () => ({
          ok: true,
          finalMessage: '# Still invalid\n',
          sessionId: 'repair'
        })
      })
    ).rejects.toThrow(
      'Failed to extract manifest for feature 001 after 2 repair attempts. Last validation error: Repair attempt 2: No ledger section found under a "## Ledger" heading.'
    );
  });
});
