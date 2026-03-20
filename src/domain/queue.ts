import { randomUUID } from 'node:crypto';

import { extractNumericFeatureId } from './slug.js';

const ENCODED_REQUEST_PREFIX = '@@openweft:request:v1:';
const V1_QUEUE_HEADER = '# openweft queue format: v1';

export interface QueueCommentLine {
  kind: 'comment';
  raw: string;
  lineIndex: number;
  recordFormat: 'legacy' | 'v1';
}

export interface QueueBlankLine {
  kind: 'blank';
  raw: string;
  lineIndex: number;
  recordFormat: 'legacy' | 'v1';
}

export interface QueuePendingLine {
  kind: 'pending';
  raw: string;
  lineIndex: number;
  request: string;
  queueId: string | null;
  recordFormat: 'legacy' | 'v1';
}

export interface QueueProcessedLine {
  kind: 'processed';
  raw: string;
  lineIndex: number;
  featureId: string;
  request: string;
  queueId: string | null;
  recordFormat: 'legacy' | 'v1';
}

export type QueueLine = QueueCommentLine | QueueBlankLine | QueuePendingLine | QueueProcessedLine;

export interface ParsedQueueFile {
  lines: QueueLine[];
  pending: QueuePendingLine[];
  processed: QueueProcessedLine[];
}

const PROCESSED_PATTERN = /^#\s*✓\s+\[(\d+)\]\s+(.+)$/;

const normalizeRequestNewlines = (request: string): string => request.replace(/\r\n?/g, '\n');
const createQueueId = (): string => `q_${randomUUID()}`;

const shouldEncodeQueueRequest = (request: string): boolean =>
  request.includes('\n') || request.startsWith('#') || request.startsWith(ENCODED_REQUEST_PREFIX);

export const normalizeQueuedRequest = (input: string): string | null => {
  const normalized = normalizeRequestNewlines(input).trim();
  return normalized === '' ? null : normalized;
};

export const summarizeQueueRequest = (request: string): string => {
  const normalized = normalizeRequestNewlines(request).trim().replace(/\s+/g, ' ');
  return normalized === '' ? '(empty request)' : normalized;
};

export const serializeQueueRequest = (request: string): string => {
  const normalized = normalizeRequestNewlines(request);
  if (!shouldEncodeQueueRequest(normalized)) {
    return normalized;
  }

  return `${ENCODED_REQUEST_PREFIX}${Buffer.from(normalized, 'utf8').toString('base64url')}`;
};

const parseSerializedQueueRequest = (raw: string): string => {
  if (!raw.startsWith(ENCODED_REQUEST_PREFIX)) {
    return raw;
  }

  const encoded = raw.slice(ENCODED_REQUEST_PREFIX.length);
  return Buffer.from(encoded, 'base64url').toString('utf8');
};

type QueueRecordV1 =
  | {
      version: 1;
      type: 'pending';
      id: string;
      request: string;
    }
  | {
      version: 1;
      type: 'processed';
      id: string;
      featureId: string;
      request: string;
    };

const isV1QueueHeader = (raw: string): boolean => raw.trim() === V1_QUEUE_HEADER;

const isQueueRecordV1 = (value: unknown): value is QueueRecordV1 => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.id !== 'string' || typeof candidate.request !== 'string') {
    return false;
  }

  if (candidate.type === 'pending') {
    return true;
  }

  return candidate.type === 'processed' && typeof candidate.featureId === 'string';
};

const parseLegacyQueueLine = (raw: string, lineIndex: number): QueueLine => {
  const trimmed = raw.trim();

  if (trimmed === '') {
    return {
      kind: 'blank',
      raw,
      lineIndex,
      recordFormat: 'legacy'
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
      request: parseSerializedQueueRequest(request),
      queueId: null,
      recordFormat: 'legacy'
    };
  }

  if (trimmed.startsWith('#')) {
    return {
      kind: 'comment',
      raw,
      lineIndex,
      recordFormat: 'legacy'
    };
  }

  return {
    kind: 'pending',
    raw,
    lineIndex,
    request: parseSerializedQueueRequest(trimmed),
    queueId: null,
    recordFormat: 'legacy'
  };
};

const parseV1QueueLine = (raw: string, lineIndex: number): QueueLine => {
  const trimmed = raw.trim();

  if (trimmed === '') {
    return {
      kind: 'blank',
      raw,
      lineIndex,
      recordFormat: 'v1'
    };
  }

  if (isV1QueueHeader(raw) || trimmed.startsWith('#')) {
    return {
      kind: 'comment',
      raw,
      lineIndex,
      recordFormat: 'v1'
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Malformed v1 queue record at line ${lineIndex}.`);
  }

  if (!isQueueRecordV1(parsed)) {
    throw new Error(`Malformed v1 queue record at line ${lineIndex}.`);
  }

  if (parsed.type === 'pending') {
    return {
      kind: 'pending',
      raw,
      lineIndex,
      request: parsed.request,
      queueId: parsed.id,
      recordFormat: 'v1'
    };
  }

  return {
    kind: 'processed',
    raw,
    lineIndex,
    featureId: parsed.featureId,
    request: parsed.request,
    queueId: parsed.id,
    recordFormat: 'v1'
  };
};

export const parseQueueLine = (raw: string, lineIndex: number): QueueLine => parseLegacyQueueLine(raw, lineIndex);

export const parseQueueFile = (content: string): ParsedQueueFile => {
  const rawLines = content.split(/\r?\n/);
  const firstContentIndex = rawLines.findIndex((line) => line.trim() !== '');
  const parseLine =
    firstContentIndex >= 0 && isV1QueueHeader(rawLines[firstContentIndex] ?? '')
      ? parseV1QueueLine
      : parseLegacyQueueLine;
  const lines = rawLines.map((line, lineIndex) => parseLine(line, lineIndex));

  return {
    lines,
    pending: lines.filter((line): line is QueuePendingLine => line.kind === 'pending'),
    processed: lines.filter((line): line is QueueProcessedLine => line.kind === 'processed')
  };
};

export const extractRequestsFromInput = (input: string): string[] => {
  const normalized = normalizeQueuedRequest(input);
  return normalized === null ? [] : [normalized];
};

export const collectRequestsFromInput = extractRequestsFromInput;

const serializeQueueRecord = (line: QueuePendingLine | QueueProcessedLine): string => {
  if (line.kind === 'pending') {
    return JSON.stringify({
      version: 1,
      type: 'pending',
      id: line.queueId ?? createQueueId(),
      request: line.request
    });
  }

  return JSON.stringify({
    version: 1,
    type: 'processed',
    id: line.queueId ?? createQueueId(),
    featureId: line.featureId,
    request: line.request
  });
};

const buildCanonicalQueueContent = (
  parsed: ParsedQueueFile,
  options?: {
    processLineIndex?: number;
    processFeatureId?: string;
    processRequestOverride?: string | undefined;
    removeLineIndex?: number;
    appendRequests?: string[];
  }
): string => {
  const lines: string[] = [V1_QUEUE_HEADER];

  for (const line of parsed.lines) {
    if (line.kind === 'blank' && line.raw === '' && line.lineIndex === parsed.lines.length - 1) {
      continue;
    }

    if (line.kind === 'comment') {
      if (isV1QueueHeader(line.raw)) {
        continue;
      }
      lines.push(line.raw);
      continue;
    }

    if (line.kind === 'blank') {
      lines.push(line.raw);
      continue;
    }

    if (options?.removeLineIndex === line.lineIndex) {
      continue;
    }

    if (options?.processLineIndex === line.lineIndex && line.kind === 'pending') {
      lines.push(
        JSON.stringify({
          version: 1,
          type: 'processed',
          id: line.queueId ?? createQueueId(),
          featureId: options.processFeatureId,
          request: options.processRequestOverride ?? line.request
        })
      );
      continue;
    }

    lines.push(serializeQueueRecord(line));
  }

  for (const request of options?.appendRequests ?? []) {
    lines.push(
      JSON.stringify({
        version: 1,
        type: 'pending',
        id: createQueueId(),
        request
      })
    );
  }

  return `${lines.join('\n')}\n`;
};

export const appendRequestsToQueueContent = (existingContent: string, requests: string[]): string => {
  const normalized = requests
    .map((request) => normalizeQueuedRequest(request))
    .filter((request): request is string => request !== null);
  if (normalized.length === 0) {
    return existingContent;
  }

  const existingPending = new Set(parseQueueFile(existingContent).pending.map((entry) => entry.request));
  const accepted: string[] = [];
  for (const request of normalized) {
    if (existingPending.has(request) || accepted.includes(request)) {
      continue;
    }
    accepted.push(request);
  }

  if (accepted.length === 0) {
    return existingContent;
  }

  return buildCanonicalQueueContent(parseQueueFile(existingContent), {
    appendRequests: accepted
  });
};

export const appendRequestsToQueueFile = appendRequestsToQueueContent;

export const markQueueLineProcessed = (
  existingContent: string,
  lineIndex: number,
  featureId: string,
  requestOverride?: string,
  expectedRequest?: string
): string => {
  const parsed = parseQueueFile(existingContent);
  const target = parsed.lines.find((line) => line.lineIndex === lineIndex);

  if (!target) {
    throw new Error(`Queue line ${lineIndex} does not exist.`);
  }

  if (target.kind !== 'pending') {
    throw new Error(`Queue line ${lineIndex} is not pending and cannot be marked processed.`);
  }

  if (expectedRequest !== undefined && target.request !== expectedRequest) {
    throw new Error(
      `Queue line ${lineIndex} no longer matches the expected request and cannot be marked processed safely.`
    );
  }

  return buildCanonicalQueueContent(parsed, {
    processLineIndex: lineIndex,
    processFeatureId: featureId,
    processRequestOverride: requestOverride
  });
};

export const removePendingQueueLine = (
  existingContent: string,
  lineIndex: number,
  expectedRequest?: string
): string => {
  const parsed = parseQueueFile(existingContent);
  const target = parsed.lines.find((line) => line.lineIndex === lineIndex);

  if (!target) {
    throw new Error(`Queue line ${lineIndex} does not exist.`);
  }

  if (target.kind !== 'pending') {
    throw new Error(`Queue line ${lineIndex} is not pending and cannot be removed.`);
  }

  if (expectedRequest !== undefined && target.request !== expectedRequest) {
    throw new Error(
      `Queue line ${lineIndex} no longer matches the expected request and cannot be removed safely.`
    );
  }

  const updated = buildCanonicalQueueContent(parsed, {
    removeLineIndex: lineIndex
  });

  const reparsed = parseQueueFile(updated);
  return reparsed.pending.length === 0 && reparsed.processed.length === 0 && reparsed.lines.every((line) => line.kind !== 'comment' || isV1QueueHeader(line.raw))
    ? ''
    : updated;
};

export const buildQueueContentFromCheckpointState = (input: {
  existingContent: string;
  processed: Array<{ featureId: string; request: string }>;
  pendingRequests: string[];
}): string => {
  const lines: string[] = [V1_QUEUE_HEADER];
  const existing = parseQueueFile(input.existingContent);
  const processed = [...input.processed].sort(
    (left, right) =>
      (extractNumericFeatureId(left.featureId) ?? Number.POSITIVE_INFINITY) -
      (extractNumericFeatureId(right.featureId) ?? Number.POSITIVE_INFINITY)
  );

  for (const line of existing.lines) {
    if (line.kind === 'comment') {
      if (isV1QueueHeader(line.raw)) {
        continue;
      }
      lines.push(line.raw);
      continue;
    }

    if (line.kind === 'blank') {
      lines.push(line.raw);
    }
  }

  for (const entry of processed) {
    lines.push(
      JSON.stringify({
        version: 1,
        type: 'processed',
        id: createQueueId(),
        featureId: entry.featureId,
        request: entry.request
      })
    );
  }

  for (const request of input.pendingRequests) {
    lines.push(
      JSON.stringify({
        version: 1,
        type: 'pending',
        id: createQueueId(),
        request
      })
    );
  }

  return `${lines.join('\n')}\n`;
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
