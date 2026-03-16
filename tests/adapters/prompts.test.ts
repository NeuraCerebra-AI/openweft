import { describe, expect, it } from 'vitest';

import {
  CODE_EDIT_SUMMARY_MARKER,
  USER_REQUEST_MARKER,
  buildExecutionPrompt,
  injectPromptTemplate
} from '../../src/adapters/prompts.js';

describe('adapter prompt helpers', () => {
  it('injects prompt markers', () => {
    expect(
      injectPromptTemplate(`Plan this: ${USER_REQUEST_MARKER}`, USER_REQUEST_MARKER, 'add dark mode')
    ).toBe('Plan this: add dark mode');
    expect(
      injectPromptTemplate(`Adjust: ${CODE_EDIT_SUMMARY_MARKER}`, CODE_EDIT_SUMMARY_MARKER, '{"files":[]}')
    ).toBe('Adjust: {"files":[]}');
  });

  it('replaces only the first occurrence when the marker appears multiple times', () => {
    const template = `${USER_REQUEST_MARKER} and also ${USER_REQUEST_MARKER}`;
    const result = injectPromptTemplate(template, USER_REQUEST_MARKER, 'x');
    expect(result).toBe(`x and also ${USER_REQUEST_MARKER}`);
  });

  it('fails when the requested marker is missing', () => {
    expect(() =>
      injectPromptTemplate('No marker here', USER_REQUEST_MARKER, 'x')
    ).toThrow(`Prompt template is missing marker ${USER_REQUEST_MARKER}.`);
  });

  it('builds the execution prompt with plan content and file reference', () => {
    const prompt = buildExecutionPrompt({
      planFilePath: '/repo/feature_requests/001_plan.md',
      planContent: '# Plan\nDo it'
    });

    expect(prompt).toContain('/repo/feature_requests/001_plan.md');
    expect(prompt).toContain('=== PLAN START ===');
    expect(prompt).toContain('# Plan\nDo it');
    expect(prompt).toContain('Do not modify the plan file');
  });
});
