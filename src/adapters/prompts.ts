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
  promptBFilePath: string;
  promptBContent: string;
  planFilePath: string;
  planContent: string;
}): string => {
  return `You are executing a feature implementation using Prompt B, the primary worker brief for this feature.
Prompt B is provided below and is also available at ${input.promptBFilePath}.

The supporting implementation plan is also provided below and is available at ${input.planFilePath}.
Use Prompt B as the main execution brief. Use the plan as the supporting artifact that defines the manifest boundaries and required validation.

Execute the work completely. Follow the brief carefully. Run all tests specified in the plan.
Do not skip steps. Do not modify the Prompt B file or the plan file. Only modify the codebase files
listed in the plan's manifest.

=== PROMPT B START ===
${input.promptBContent}
=== PROMPT B END ===

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
