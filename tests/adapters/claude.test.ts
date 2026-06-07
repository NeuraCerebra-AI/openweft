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
      '--no-session-persistence',
      '--max-budget-usd',
      '1.5',
      '--add-dir',
      '/tmp/shared',
      '/tmp/extra'
    ]);
    expect(command.input).toBe('Reply with OK.');
    expect(command.idleTimeoutMs).toBe(90 * 60 * 1000);
    expect(command.args).not.toContain('--effort');
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
      '--resume',
      'session-456',
      '--max-budget-usd',
      '1.5',
      '--add-dir',
      '/tmp/shared',
      '/tmp/extra'
    ]);
    expect(command.idleTimeoutMs).toBe(90 * 60 * 1000);
  });

  it('rejects effort levels that Claude does not support', () => {
    expect(() => buildClaudeCommand({
      ...baseRequest(),
      effortLevel: 'xhigh'
    } as AdapterTurnRequest & { effortLevel: 'xhigh' })).toThrow(
      'Unsupported Claude effort level: xhigh'
    );
  });

  it('adds an effort flag for non-medium new sessions', () => {
    const command = buildClaudeCommand({
      ...baseRequest(),
      effortLevel: 'high'
    } as AdapterTurnRequest & { effortLevel: 'high' });

    expect(command.args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--model',
      'claude-sonnet-4-6',
      '--effort',
      'high',
      '--dangerously-skip-permissions',
      '--no-session-persistence',
      '--max-budget-usd',
      '1.5',
      '--add-dir',
      '/tmp/shared',
      '/tmp/extra'
    ]);
  });

  it('adds an effort flag for non-medium resumed sessions', () => {
    const command = buildClaudeCommand({
      ...baseRequest(),
      sessionId: 'session-456',
      persistSession: true,
      effortLevel: 'max'
    } as AdapterTurnRequest & { effortLevel: 'max' });

    expect(command.args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--model',
      'claude-sonnet-4-6',
      '--effort',
      'max',
      '--dangerously-skip-permissions',
      '--resume',
      'session-456',
      '--max-budget-usd',
      '1.5',
      '--add-dir',
      '/tmp/shared',
      '/tmp/extra'
    ]);
  });

  it('uses a shorter idle timeout for planning stages', () => {
    const command = buildClaudeCommand({
      ...baseRequest(),
      stage: 'planning-s2'
    });

    expect(command.idleTimeoutMs).toBe(30 * 60 * 1000);
  });

  it('skips permissions for plan-mode turns (headless execution)', () => {
    const command = buildClaudeCommand({
      ...baseRequest(),
      claudePermissionMode: 'plan'
    });

    expect(command.args).toContain('--dangerously-skip-permissions');
    expect(command.args).not.toContain('--permission-mode');
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

  it('prefers an explicit top-level model field over a modelUsage key (D3)', () => {
    const output = JSON.stringify({
      is_error: false,
      result: 'OK',
      session_id: 's1',
      model: 'claude-opus-4-6',
      modelUsage: {
        'claude-haiku-4-6': { inputTokens: 1 },
        'claude-opus-4-6': { inputTokens: 2 }
      },
      usage: { input_tokens: 3, output_tokens: 4 }
    });

    const parsed = parseClaudeJsonOutput(output, 'claude-sonnet-4-6');

    expect(parsed.model).toBe('claude-opus-4-6');
  });

  it('falls back to the requested model when modelUsage has multiple keys and no top-level model (D3)', () => {
    const output = JSON.stringify({
      is_error: false,
      result: 'OK',
      session_id: 's1',
      modelUsage: {
        'claude-haiku-4-6': { inputTokens: 1 },
        'claude-opus-4-6': { inputTokens: 2 }
      },
      usage: { input_tokens: 3, output_tokens: 4 }
    });

    const parsed = parseClaudeJsonOutput(output, 'claude-sonnet-4-6');

    // Previously this returned an arbitrary first modelUsage key
    // ('claude-haiku-4-6'), mis-attributing aggregate usage.
    expect(parsed.model).toBe('claude-sonnet-4-6');
  });

  it('still uses the single modelUsage key when exactly one model is present (D3 regression guard)', () => {
    const output = JSON.stringify({
      is_error: false,
      result: 'OK',
      session_id: 's1',
      modelUsage: { 'claude-opus-4-6': { inputTokens: 2 } },
      usage: { input_tokens: 3, output_tokens: 4 }
    });

    const parsed = parseClaudeJsonOutput(output, 'claude-sonnet-4-6');

    expect(parsed.model).toBe('claude-opus-4-6');
  });

  it('throws when claude output has is_error: true with a result message', () => {
    const errorOutput = JSON.stringify({ is_error: true, result: 'API rate limit hit' });
    expect(() => parseClaudeJsonOutput(errorOutput, 'claude-sonnet-4-6')).toThrow('API rate limit hit');
  });

  it('throws when claude output has is_error: true without a result string', () => {
    const errorOutput = JSON.stringify({ is_error: true });
    expect(() => parseClaudeJsonOutput(errorOutput, 'claude-sonnet-4-6')).toThrow('Claude returned an error result.');
  });

  it('throws when claude output has no result field', () => {
    const output = JSON.stringify({ is_error: false, session_id: 'x', usage: {} });
    expect(() => parseClaudeJsonOutput(output, 'claude-sonnet-4-6')).toThrow('Claude output did not include a result string.');
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

  it('D2: classifies a signal-killed subprocess as transient even with fatal-sounding stderr', async () => {
    const adapter = new ClaudeCliAdapter(async () => ({
      stdout: '',
      stderr: 'authentication',
      exitCode: 1,
      signal: 'SIGKILL',
      timedOut: false
    }));

    const result = await adapter.runTurn(baseRequest());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.classified.tier).toBe('transient');
    }
  });

  it('D2: classifies a timed-out subprocess as transient', async () => {
    const adapter = new ClaudeCliAdapter(async () => ({
      stdout: '',
      stderr: 'authentication',
      exitCode: 1,
      signal: null,
      timedOut: true
    }));

    const result = await adapter.runTurn(baseRequest());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.classified.tier).toBe('transient');
    }
  });
});
