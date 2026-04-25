import { describe, expect, it } from 'vitest';

import {
  CODEX_MODEL_OPTIONS,
  getDefaultModelForBackend,
  getModelOptionsForBackend
} from '../../src/config/options.js';

describe('model options', () => {
  it('uses GPT-5.5 as the default Codex platform model', () => {
    expect(getDefaultModelForBackend('codex')).toBe('gpt-5.5');
    expect(CODEX_MODEL_OPTIONS[0]).toBe('gpt-5.5');
  });

  it('keeps previous Codex-capable models available as fallback selections', () => {
    expect(getModelOptionsForBackend('codex')).toEqual([
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark'
    ]);
  });
});
