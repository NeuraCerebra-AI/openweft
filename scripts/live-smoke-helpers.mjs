import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TIMEOUT_ENV = 'OPENWEFT_LIVE_SMOKE_TIMEOUT_MS';
const MALFORMED_PREVIEW_LIMIT = 160;
const MAX_TIMEOUT_MS = 2_147_483_647;

const formatError = (error) => (error instanceof Error ? error.message : String(error));

const readOptionalText = async (filePath) => {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
};

const safePreview = (line) => {
  const normalized = line.replace(/\s+/g, ' ').trim();
  return normalized.length > MALFORMED_PREVIEW_LIMIT
    ? `${normalized.slice(0, MALFORMED_PREVIEW_LIMIT)}...`
    : normalized;
};

const parseJsonLinesDefensively = (content) => {
  const records = [];
  const malformedLines = [];

  for (const [index, line] of content.split('\n').entries()) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const record = JSON.parse(line);
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        malformedLines.push({
          lineNumber: index + 1,
          preview: `${safePreview(line)} (not an object)`
        });
        continue;
      }
      records.push(record);
    } catch {
      malformedLines.push({
        lineNumber: index + 1,
        preview: safePreview(line)
      });
    }
  }

  return { records, malformedLines };
};

const malformedSummary = (malformedLines) => ({
  malformedLineCount: malformedLines.length,
  malformedLinePreviews: malformedLines.slice(0, 3)
});

const finiteNumberOrZero = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export const parseLiveSmokeTimeoutMs = (rawValue = process.env[`${TIMEOUT_ENV}`]) => {
  if (rawValue === undefined) {
    return null;
  }

  if (!/^[0-9]+$/.test(rawValue)) {
    throw new Error(`${TIMEOUT_ENV} must be a positive integer when set.`);
  }

  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_TIMEOUT_MS) {
    throw new Error(`${TIMEOUT_ENV} must be a positive integer when set.`);
  }

  return parsed;
};

export const readJsonLines = async (filePath) => {
  const content = await readFile(filePath, 'utf8');
  return content
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
};

export const printSmokeDiagnostics = async ({ tempRepo, writeLine = console.error }) => {
  const checkpointContent = await readOptionalText(path.join(tempRepo, '.openweft', 'checkpoint.json'));
  if (checkpointContent?.trim()) {
    try {
      const checkpoint = JSON.parse(checkpointContent);
      const featureStatuses = Object.fromEntries(
        Object.entries(checkpoint.features ?? {}).map(([featureId, feature]) => [
          featureId,
          {
            status: feature.status,
            sessionScope: feature.sessionScope ?? null,
            lastError: feature.lastError ?? null
          }
        ])
      );
      writeLine('Checkpoint summary:');
      writeLine(
        JSON.stringify(
          {
            status: checkpoint.status,
            currentState: checkpoint.currentState,
            currentPhaseIndex: checkpoint.currentPhaseIndex,
            featureStatuses
          },
          null,
          2
        )
      );
    } catch (error) {
      writeLine(`Checkpoint summary: failed to parse checkpoint.json: ${formatError(error)}`);
    }
  } else {
    writeLine('Checkpoint summary:');
    writeLine('No checkpoint found.');
  }

  const auditContent = await readOptionalText(path.join(tempRepo, '.openweft', 'audit-trail.jsonl'));
  writeLine('Recent audit events:');
  if (auditContent?.trim()) {
    const { records, malformedLines } = parseJsonLinesDefensively(auditContent);
    const recentAuditEvents = records.slice(-12).map((entry) => ({
      timestamp: entry.timestamp,
      event: entry.event,
      featureId: entry.data?.featureId,
      stage: entry.data?.stage,
      message: entry.message
    }));
    writeLine(
      JSON.stringify(
        {
          events: recentAuditEvents,
          ...malformedSummary(malformedLines)
        },
        null,
        2
      )
    );
  } else {
    writeLine('No audit events found.');
  }

  const costsContent = await readOptionalText(path.join(tempRepo, '.openweft', 'costs.jsonl'));
  writeLine('Cost summary:');
  if (costsContent?.trim()) {
    const { records, malformedLines } = parseJsonLinesDefensively(costsContent);
    const summary = records.reduce(
      (acc, record) => ({
        turns: acc.turns + 1,
        inputTokens: acc.inputTokens + finiteNumberOrZero(record.inputTokens),
        outputTokens: acc.outputTokens + finiteNumberOrZero(record.outputTokens),
        estimatedCostUsd: acc.estimatedCostUsd + finiteNumberOrZero(record.estimatedCostUsd)
      }),
      { turns: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }
    );
    writeLine(
      JSON.stringify(
        {
          ...summary,
          estimatedCostUsd: Number(summary.estimatedCostUsd.toFixed(6)),
          ...malformedSummary(malformedLines)
        },
        null,
        2
      )
    );
  } else {
    writeLine('No cost records found.');
  }
};

export const printSmokeDiagnosticsSafely = async ({
  tempRepo,
  writeLine = console.error,
  printDiagnostics = printSmokeDiagnostics
}) => {
  try {
    await printDiagnostics({ tempRepo, writeLine });
  } catch (error) {
    writeLine(`Smoke diagnostics failed: ${formatError(error)}`);
  }
};
