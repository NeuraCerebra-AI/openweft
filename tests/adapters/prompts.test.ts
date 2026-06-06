import { describe, expect, it } from 'vitest';

import {
  buildConflictResolutionPrompt,
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

  it('replaces every occurrence when the marker appears multiple times', () => {
    const template = `${USER_REQUEST_MARKER} and also ${USER_REQUEST_MARKER}`;
    const result = injectPromptTemplate(template, USER_REQUEST_MARKER, 'x');
    expect(result).toBe('x and also x');
  });

  it('fails when the requested marker is missing', () => {
    expect(() =>
      injectPromptTemplate('No marker here', USER_REQUEST_MARKER, 'x')
    ).toThrow(`Prompt template is missing marker ${USER_REQUEST_MARKER}.`);
  });

  it('builds the execution prompt with work brief and living plan ledger context', () => {
    const prompt = buildExecutionPrompt({
      promptBFilePath: '/repo/feature_requests/briefs/001_work-brief.md',
      promptBContent: '# Work Brief\nWork carefully',
      planFilePath: '/repo/feature_requests/001_plan.md',
      planContent: '# Plan\nDo it'
    });

    expect(prompt).toContain('/repo/feature_requests/briefs/001_work-brief.md');
    expect(prompt).toContain('=== WORK BRIEF START ===');
    expect(prompt).toContain('# Work Brief\nWork carefully');
    expect(prompt).toContain('/repo/feature_requests/001_plan.md');
    expect(prompt).toContain('=== PLAN START ===');
    expect(prompt).toContain('# Plan\nDo it');
    expect(prompt).toContain('Do not modify the Work Brief file.');
    expect(prompt).toContain('The plan file is the Living Plan Ledger');
    expect(prompt).toContain('Only update the plan file to keep its ## Ledger truthful');
    expect(prompt).toContain(
      'If the Work Brief or plan contains read-only/no-write language meant for planning'
    );
    expect(prompt).toContain('still implement the manifest-scoped change');
  });

  it('builds a conflict-resolution prompt with plan context when available', () => {
    const prompt = buildConflictResolutionPrompt({
      instruction: 'Resolve all conflict markers, preserve both sides, then commit.',
      planFilePath: '/repo/feature_requests/001_plan.md',
      planContent: '# Plan\nKeep both changes where compatible'
    });

    expect(prompt).toContain('/repo/feature_requests/001_plan.md');
    expect(prompt).toContain('=== PLAN START ===');
    expect(prompt).toContain('Keep both changes where compatible');
    expect(prompt).toContain('Resolve all conflict markers');
  });

  it('falls back to the bare conflict-resolution instruction when plan context is unavailable', () => {
    expect(
      buildConflictResolutionPrompt({
        instruction: 'Resolve the conflicts.',
        planFilePath: null,
        planContent: null
      })
    ).toBe('Resolve the conflicts.');
  });
});
