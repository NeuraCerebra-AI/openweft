import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { CodexCliAdapter, buildCodexCommand, parseCodexJsonlOutput } from '../../src/adapters/codex.js';
import type { AdapterTurnRequest } from '../../src/adapters/types.js';

const codexFixturePath = new URL('../fixtures/adapters/codex-success.jsonl', import.meta.url);

const baseRequest = (): AdapterTurnRequest => ({
  featureId: '001',
  stage: 'execution',
  cwd: '/tmp/openweft-test',
  prompt: 'Reply with OK.',
  model: 'gpt-5.3-codex',
  auth: { method: 'subscription' },
  persistSession: false,
  isolatedHomeDir: '/tmp/codex-home',
  sandboxMode: 'workspace-write',
  additionalDirectories: ['/tmp/shared']
});

describe('codex adapter', () => {
  it('builds a new-session command that uses stdin and isolated CODEX_HOME', () => {
    const command = buildCodexCommand(baseRequest());

    expect(command.command).toBe('codex');
    expect(command.args).toEqual([
      'exec',
      '--sandbox',
      'workspace-write',
      '-C',
      '/tmp/openweft-test',
      '--ephemeral',
      '--add-dir',
      '/tmp/shared',
      '--json',
      '--color',
      'never',
      '--model',
      'gpt-5.3-codex',
      '-'
    ]);
    expect(command.input).toBe('Reply with OK.');
    expect(command.env).toEqual({ CODEX_HOME: '/tmp/codex-home' });
  });

  it('builds a resume command without new-session flags', () => {
    const command = buildCodexCommand({
      ...baseRequest(),
      sessionId: 'session-123',
      persistSession: true
    });

    expect(command.args).toEqual([
      'exec',
      'resume',
      'session-123',
      '--json',
      '--model',
      'gpt-5.3-codex',
      '-'
    ]);
  });

  it('parses codex JSONL success output from a fixture', async () => {
    const output = await readFile(codexFixturePath, 'utf8');
    const parsed = parseCodexJsonlOutput(output);

    expect(parsed.sessionId).toBe('019ce7d7-cea4-74e2-847b-a65bb70fbe57');
    expect(parsed.finalMessage).toBe('OK');
    expect(parsed.usage.inputTokens).toBe(16017);
    expect(parsed.usage.cachedInputTokens).toBe(3456);
    expect(parsed.usage.outputTokens).toBe(32);
  });

  it('classifies non-zero exit failures', async () => {
    const adapter = new CodexCliAdapter(async () => ({
      stdout: '',
      stderr: 'HTTP 429 rate limit exceeded',
      exitCode: 1
    }));

    const result = await adapter.runTurn(baseRequest());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.classified.tier).toBe('transient');
    }
  });
});
