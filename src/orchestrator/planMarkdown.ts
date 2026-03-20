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

export const repairPlanMarkdownIfNeeded = async (input: {
  featureId: string;
  request: string;
  initialMarkdown: string;
  shadowMarkdown: string | null;
  runRepairTurn: (prompt: string) => Promise<PlanRepairTurnResult>;
}): Promise<{ markdown: string; manifest: Manifest; sessionId: string | null }> => {
  const lastKnownGoodOpts: { lastKnownGood?: Manifest } = {};
  if (input.shadowMarkdown) {
    try {
      lastKnownGoodOpts.lastKnownGood = parseManifestDocument(input.shadowMarkdown).manifest;
    } catch {
      // Ignore invalid shadow plans and fall back to normal repair behavior.
    }
  }

  try {
    assertLedgerSection(input.initialMarkdown);
    const parsed = parseManifestDocument(input.initialMarkdown, lastKnownGoodOpts);
    return {
      markdown: updateManifestInMarkdown(input.initialMarkdown, parsed.manifest),
      manifest: parsed.manifest,
      sessionId: null
    };
  } catch {
    // Fall through to repair attempts.
  }

  const maxRepairAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRepairAttempts; attempt += 1) {
    const repairPrompt = [
      `Your previous plan output for feature ${input.featureId} was invalid (attempt ${attempt}).`,
      `Feature request: ${input.request}`,
      '',
      'You MUST output the complete Markdown plan as your text response.',
      'The plan MUST include a "## Ledger" section covering constraints, assumptions, watchpoints, and validation.',
      'The plan MUST include a "## Manifest" heading followed by a ```json code block containing { "create": [], "modify": [], "delete": [] }.',
      'Do NOT write any files. Do NOT enter plan mode. Do NOT use Write, Edit, or ExitPlanMode tools.',
      'Return the full plan document as plain text in your response.'
    ].join('\n');

    const repairResult = await input.runRepairTurn(repairPrompt);
    if (!repairResult.ok) {
      lastError = new Error(`Repair attempt ${attempt} failed: ${repairResult.error}`);
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
      lastError = new Error(
        `Repair attempt ${attempt}: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
    }
  }

  throw new Error(
    `Failed to extract manifest for feature ${input.featureId} after ${maxRepairAttempts} repair attempts. ` +
    `${lastError?.message ?? 'No additional details.'} ` +
    'This usually means the AI backend returned a summary instead of the full plan markdown.'
  );
};
