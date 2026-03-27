import {
  assertLedgerSection,
  parseManifestDocument,
  type Manifest,
  updateManifestInMarkdown
} from '../domain/manifest.js';

interface PlanRepairSuccess {
  ok: true;
  finalMessage: string;
  sessionId: string | null;
}

interface PlanRepairFailure {
  ok: false;
  error: string;
}

type PlanRepairTurnResult = PlanRepairSuccess | PlanRepairFailure;

interface InvalidPlanAttempt {
  attempt: number;
  source: 'initial' | 'repair' | 'repair-turn-failed';
  error: string;
  markdown: string | null;
  sessionId: string | null;
}

export const repairPlanMarkdownIfNeeded = async (input: {
  featureId: string;
  request: string;
  initialMarkdown: string;
  shadowMarkdown: string | null;
  promptBMarkdown?: string;
  runRepairTurn: (prompt: string) => Promise<PlanRepairTurnResult>;
  onInvalidPlanAttempt?: (attempt: InvalidPlanAttempt) => Promise<void> | void;
}): Promise<{ markdown: string; manifest: Manifest; sessionId: string | null }> => {
  const lastKnownGoodOpts: { lastKnownGood?: Manifest } = {};
  if (input.shadowMarkdown) {
    try {
      lastKnownGoodOpts.lastKnownGood = parseManifestDocument(input.shadowMarkdown).manifest;
    } catch {
      // Ignore invalid shadow plans and fall back to normal repair behavior.
    }
  }

  const maxRepairAttempts = 2;
  let lastError: Error | null = null;
  let lastValidationError = 'Unknown planning validation failure.';
  let lastRejectedMarkdown = input.initialMarkdown;

  try {
    assertLedgerSection(input.initialMarkdown);
    const parsed = parseManifestDocument(input.initialMarkdown, lastKnownGoodOpts);
    return {
      markdown: updateManifestInMarkdown(input.initialMarkdown, parsed.manifest),
      manifest: parsed.manifest,
      sessionId: null
    };
  } catch (error) {
    lastValidationError = error instanceof Error ? error.message : String(error);
    await input.onInvalidPlanAttempt?.({
      attempt: 0,
      source: 'initial',
      error: lastValidationError,
      markdown: input.initialMarkdown,
      sessionId: null
    });
    // Fall through to repair attempts.
  }

  for (let attempt = 1; attempt <= maxRepairAttempts; attempt += 1) {
    const repairPrompt = [
      `Your previous plan output for feature ${input.featureId} was invalid (attempt ${attempt}).`,
      `Feature request: ${input.request}`,
      `Previous validation error: ${lastValidationError}`,
      '',
      'Use the original Prompt B context below to regenerate the plan faithfully.',
      input.promptBMarkdown
        ? ['=== PROMPT B START ===', input.promptBMarkdown.trimEnd(), '=== PROMPT B END ===', ''].join('\n')
        : '',
      'Use the rejected plan markdown below to correct the exact structural problems that were detected.',
      '=== REJECTED PLAN MARKDOWN START ===',
      lastRejectedMarkdown.trimEnd(),
      '=== REJECTED PLAN MARKDOWN END ===',
      '',
      'You MUST output the complete Markdown plan as your text response.',
      'The plan MUST include a "## Ledger" section covering constraints, assumptions, watchpoints, and validation.',
      'The plan MUST include a "## Manifest" heading followed by a ```json code block containing { "create": [], "modify": [], "delete": [] }.',
      'Do NOT write any files. Do NOT enter plan mode. Do NOT use Write, Edit, or ExitPlanMode tools.',
      'Return the full plan document as plain text in your response.'
    ]
      .filter((line) => line.length > 0)
      .join('\n');

    const repairResult = await input.runRepairTurn(repairPrompt);
    if (!repairResult.ok) {
      lastError = new Error(`Repair attempt ${attempt} failed: ${repairResult.error}`);
      lastValidationError = lastError.message;
      await input.onInvalidPlanAttempt?.({
        attempt,
        source: 'repair-turn-failed',
        error: repairResult.error,
        markdown: null,
        sessionId: null
      });
      continue;
    }

    try {
      assertLedgerSection(repairResult.finalMessage);
      const repaired = parseManifestDocument(repairResult.finalMessage, lastKnownGoodOpts);
      return {
        markdown: updateManifestInMarkdown(repairResult.finalMessage, repaired.manifest),
        manifest: repaired.manifest,
        sessionId: repairResult.sessionId
      };
    } catch (parseError) {
      lastRejectedMarkdown = repairResult.finalMessage;
      await input.onInvalidPlanAttempt?.({
        attempt,
        source: 'repair',
        error: parseError instanceof Error ? parseError.message : String(parseError),
        markdown: repairResult.finalMessage,
        sessionId: repairResult.sessionId
      });
      lastError = new Error(
        `Repair attempt ${attempt}: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
      lastValidationError = parseError instanceof Error ? parseError.message : String(parseError);
    }
  }

  throw new Error(
    `Failed to extract manifest for feature ${input.featureId} after ${maxRepairAttempts} repair attempts. ` +
    `Last validation error: ${lastError?.message ?? lastValidationError}`
  );
};
