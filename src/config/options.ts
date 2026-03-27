import type { UserBackend } from '../domain/primitives.js';

export const CODEX_MODEL_OPTIONS = [
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex-spark'
] as const;

export const CLAUDE_MODEL_OPTIONS = [
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-6'
] as const;

export const CODEX_EFFORT_OPTIONS = ['low', 'medium', 'high', 'xhigh'] as const;
export const CLAUDE_EFFORT_OPTIONS = ['low', 'medium', 'high', 'max'] as const;
export const APPROVAL_MODE_OPTIONS = ['always', 'per-feature', 'first-only'] as const;

export type CodexEffortLevel = typeof CODEX_EFFORT_OPTIONS[number];
export type ClaudeEffortLevel = typeof CLAUDE_EFFORT_OPTIONS[number];
export type BackendEffortLevel = CodexEffortLevel | ClaudeEffortLevel;
export type ApprovalMode = typeof APPROVAL_MODE_OPTIONS[number];

export const getModelOptionsForBackend = (
  backend: UserBackend,
  currentModel?: string
): string[] => {
  const baseOptions: string[] =
    backend === 'codex' ? [...CODEX_MODEL_OPTIONS] : [...CLAUDE_MODEL_OPTIONS];

  if (currentModel && !baseOptions.includes(currentModel)) {
    return [currentModel, ...baseOptions];
  }

  return baseOptions;
};

export const getDefaultModelForBackend = (backend: UserBackend): string => {
  return backend === 'codex' ? CODEX_MODEL_OPTIONS[0] : CLAUDE_MODEL_OPTIONS[0];
};

export const getEffortOptionsForBackend = (
  backend: UserBackend
): readonly BackendEffortLevel[] => {
  return backend === 'codex' ? CODEX_EFFORT_OPTIONS : CLAUDE_EFFORT_OPTIONS;
};

export const getDefaultEffortForBackend = (
  _backend: UserBackend
): BackendEffortLevel => {
  return 'medium';
};
