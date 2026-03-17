export const USER_REQUEST_MARKER = '{{USER_REQUEST}}';
export const CODE_EDIT_SUMMARY_MARKER = '{{CODE_EDIT_SUMMARY}}';

export const injectPromptTemplate = (
  template: string,
  marker: string,
  replacement: string
): string => {
  if (!template.includes(marker)) {
    throw new Error(`Prompt template is missing marker ${marker}.`);
  }

  return template.replaceAll(marker, replacement);
};

export const buildExecutionPrompt = (input: {
  planFilePath: string;
  planContent: string;
}): string => {
  return `You are executing a feature implementation plan. The full plan is provided below
AND is available at ${input.planFilePath} for reference during execution.

Execute this plan completely. Follow every step. Run all tests specified in the plan.
Do not skip steps. Do not modify the plan file - only modify the codebase files
listed in the plan's manifest.

=== PLAN START ===
${input.planContent}
=== PLAN END ===`;
};

export const buildConflictResolutionPrompt = (input: {
  instruction: string;
  planFilePath?: string | null;
  planContent?: string | null;
}): string => {
  if (!input.planFilePath || !input.planContent) {
    return input.instruction;
  }

  return `You are resolving a merge conflict for an OpenWeft feature.
The original implementation plan is available at ${input.planFilePath} and is included below for context.
Use it to preserve the intended feature behavior while reconciling both sides of the merge.

=== PLAN START ===
${input.planContent}
=== PLAN END ===

${input.instruction}`;
};
