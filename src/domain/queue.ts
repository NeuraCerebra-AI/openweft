import { extractNumericFeatureId } from './slug.js';

export interface QueueCommentLine {
  kind: 'comment';
  raw: string;
  lineIndex: number;
}

export interface QueueBlankLine {
  kind: 'blank';
  raw: string;
  lineIndex: number;
}

export interface QueuePendingLine {
  kind: 'pending';
  raw: string;
  lineIndex: number;
  request: string;
}

export interface QueueProcessedLine {
  kind: 'processed';
  raw: string;
  lineIndex: number;
  featureId: string;
  request: string;
}

export type QueueLine = QueueCommentLine | QueueBlankLine | QueuePendingLine | QueueProcessedLine;

export interface ParsedQueueFile {
  lines: QueueLine[];
  pending: QueuePendingLine[];
  processed: QueueProcessedLine[];
}

const PROCESSED_PATTERN = /^#\s*✓\s+\[(\d+)\]\s+(.+)$/;

export const parseQueueLine = (raw: string, lineIndex: number): QueueLine => {
  const trimmed = raw.trim();

  if (trimmed === '') {
    return {
      kind: 'blank',
      raw,
      lineIndex
    };
  }

  const processedMatch = raw.match(PROCESSED_PATTERN);
  if (processedMatch) {
    const [, featureId, request] = processedMatch;
    if (!featureId || !request) {
      throw new Error(`Invalid processed queue line: ${raw}`);
    }

    return {
      kind: 'processed',
      raw,
      lineIndex,
      featureId,
      request
    };
  }

  if (trimmed.startsWith('#')) {
    return {
      kind: 'comment',
      raw,
      lineIndex
    };
  }

  return {
    kind: 'pending',
    raw,
    lineIndex,
    request: trimmed
  };
};

export const parseQueueFile = (content: string): ParsedQueueFile => {
  const lines = content.split(/\r?\n/).map((line, lineIndex) => parseQueueLine(line, lineIndex));

  return {
    lines,
    pending: lines.filter((line): line is QueuePendingLine => line.kind === 'pending'),
    processed: lines.filter((line): line is QueueProcessedLine => line.kind === 'processed')
  };
};

export const extractRequestsFromInput = (input: string): string[] => {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
};

export const collectRequestsFromInput = extractRequestsFromInput;

export const appendRequestsToQueueContent = (existingContent: string, requests: string[]): string => {
  const normalized = requests.map((request) => request.trim()).filter(Boolean);
  if (normalized.length === 0) {
    return existingContent;
  }

  const needsLeadingNewline = existingContent.length > 0 && !existingContent.endsWith('\n');
  const prefix = needsLeadingNewline ? '\n' : '';
  const suffix = normalized.join('\n');
  return `${existingContent}${prefix}${suffix}\n`;
};

export const appendRequestsToQueueFile = appendRequestsToQueueContent;

export const markQueueLineProcessed = (
  existingContent: string,
  lineIndex: number,
  featureId: string,
  requestOverride?: string
): string => {
  const parsed = parseQueueFile(existingContent);
  const target = parsed.lines.find((line) => line.lineIndex === lineIndex);

  if (!target) {
    throw new Error(`Queue line ${lineIndex} does not exist.`);
  }

  if (target.kind !== 'pending') {
    throw new Error(`Queue line ${lineIndex} is not pending and cannot be marked processed.`);
  }

  const rawLines = existingContent.split(/\r?\n/);
  if (existingContent.endsWith('\n')) {
    rawLines.pop();
  }

  rawLines[lineIndex] = `# ✓ [${featureId}] ${requestOverride ?? target.request}`;
  return existingContent.endsWith('\n') ? `${rawLines.join('\n')}\n` : rawLines.join('\n');
};

export const getNextFeatureIdFromQueue = (existingNames: Iterable<string>, queueContent = ''): number => {
  let highest = 0;

  for (const name of existingNames) {
    const parsed = extractNumericFeatureId(name);
    if (parsed !== null) {
      highest = Math.max(highest, parsed);
    }
  }

  for (const processed of parseQueueFile(queueContent).processed) {
    highest = Math.max(highest, Number.parseInt(processed.featureId, 10));
  }

  return highest + 1;
};
