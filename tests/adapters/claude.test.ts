import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { ClaudeCliAdapter, buildClaudeCommand, parseClaudeJsonOutput } from '../../src/adapters/claude.js';
import type { AdapterTurnRequest } from '../../src/adapters/types.js';

const claudeFixturePath = new URL('../fixtures/adapters/claude-success.json', import.meta.url);

const baseRequest = (): AdapterTurnRequest => ({
  featureId: '001',
  stage: 'execution',
  cwd: '/tmp/openweft-test',
  prompt: 'Reply with OK.',
  model: 'claude-sonnet-4-6',
  auth: { method: 'subscription' },
  persistSession: false,
  claudePermissionMode: 'acceptEdits',
  additionalDirectories: ['/tmp/shared', '/tmp/extra'],
  maxBudgetUsd: 1.5
});

describe('claude adapter', () => {
  it('builds a new-session command that uses stdin and json output', () => {
    const command = buildClaudeCommand(baseRequest());

    expect(command.command).toBe('claude');
    expect(command.args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--model',
      'claude-sonnet-4-6',
      '--dangerously-skip-permissions',
      '--permission-mode',
      'acceptEdits',
      '--no-session-persistence',
      '--max-budget-usd',
      '1.5',
      '--add-dir',
      '/tmp/shared',
      '/tmp/extra'
    ]);
    expect(command.input).toBe('Reply with OK.');
  });

  it('builds a resume command that preserves the session id', () => {
    const command = buildClaudeCommand({
      ...baseRequest(),
      sessionId: 'session-456',
      persistSession: true
    });

    expect(command.args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--model',
      'claude-sonnet-4-6',
      '--dangerously-skip-permissions',
      '--permission-mode',
      'acceptEdits',
      '--resume',
      'session-456',
      '--max-budget-usd',
      '1.5',
      '--add-dir',
      '/tmp/shared',
      '/tmp/extra'
    ]);
  });

  it('always includes dangerously-skip-permissions when permission mode is omitted', () => {
    const request = baseRequest();
    delete request.claudePermissionMode;

    const command = buildClaudeCommand(request);

    expect(command.args).toContain('--dangerously-skip-permissions');
  });

  it('parses claude json success output from a fixture', async () => {
    const output = await readFile(claudeFixturePath, 'utf8');
    const parsed = parseClaudeJsonOutput(output, 'claude-sonnet-4-6');

    expect(parsed.sessionId).toBe('301a3ffa-12e2-4a3e-a80c-8f0c798a8a85');
    expect(parsed.finalMessage).toBe('OK');
    expect(parsed.model).toBe('claude-opus-4-6');
    expect(parsed.usage.inputTokens).toBe(3);
    expect(parsed.usage.outputTokens).toBe(4);
    expect(parsed.usage.cacheCreationInputTokens).toBe(42826);
    expect(parsed.usage.totalCostUsd).toBe(0.2677775);
  });

  it('classifies missing-auth failures as fatal', async () => {
    const adapter = new ClaudeCliAdapter(async () => ({
      stdout: '',
      stderr: 'Authentication failed: not logged in',
      exitCode: 1
    }));

    const result = await adapter.runTurn(baseRequest());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.classified.tier).toBe('fatal');
    }
  });
});
