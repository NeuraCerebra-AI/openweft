import JSON5 from 'json5';
import { jsonrepair } from 'jsonrepair';
import type { Code } from 'mdast';
import { toString } from 'mdast-util-to-string';
import { unified } from 'unified';
import { EXIT, visit } from 'unist-util-visit';
import remarkParse from 'remark-parse';

import { normalizeRelativePath } from './paths.js';
export { ManifestSchema, type Manifest } from './primitives.js';
import { ManifestSchema, type Manifest } from './primitives.js';
export type FileManifest = Manifest;
export type ManifestOperation = keyof Manifest;

export interface ManifestBlock {
  raw: string;
  startOffset: number;
  endOffset: number;
  node: Code;
}

export type ManifestParseMethod = 'json' | 'jsonrepair' | 'json5' | 'last-known-good';

export interface ParsedManifest {
  manifest: Manifest;
  method: ManifestParseMethod;
  block: ManifestBlock;
}

export interface ParsedManifestDocument {
  manifest: Manifest;
  recoveryMethod: ManifestParseMethod;
  block: ManifestBlock;
}

const REQUIRED_LEDGER_SUBHEADINGS = ['Constraints', 'Assumptions', 'Watchpoints', 'Validation'] as const;
type RequiredLedgerSubheading = typeof REQUIRED_LEDGER_SUBHEADINGS[number];
const LEDGER_HEADING_BY_NORMALIZED = new Map<string, RequiredLedgerSubheading>(
  REQUIRED_LEDGER_SUBHEADINGS.flatMap((heading) => {
    const normalized = heading.toLowerCase();
    return [
      [normalized, heading],
      [normalized.replace(/s$/, ''), heading]
    ] as Array<[string, RequiredLedgerSubheading]>;
  })
);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const normalizeManifest = (manifest: Manifest): Manifest => {
  const normalizeEntries = (entries: string[]) => [...new Set(entries.map((entry) => normalizeRelativePath(entry)))];

  return {
    create: normalizeEntries(manifest.create),
    modify: normalizeEntries(manifest.modify),
    delete: normalizeEntries(manifest.delete)
  };
};

export const extractManifestBlock = (markdown: string): ManifestBlock | null => {
  const tree = unified().use(remarkParse).parse(markdown);
  let underManifestHeading = false;
  let manifestNode: ManifestBlock | null = null;

  visit(tree, (node) => {
    if (node.type === 'heading' && node.depth === 2) {
      underManifestHeading = toString(node).trim() === 'Manifest';
      return;
    }

    if (node.type === 'heading' && node.depth <= 2) {
      underManifestHeading = false;
      return;
    }

    if (
      underManifestHeading &&
      node.type === 'code' &&
      node.position &&
      (node.lang === 'json' || node.lang === 'json manifest')
    ) {
      manifestNode = {
        raw: node.value,
        startOffset: node.position.start.offset ?? 0,
        endOffset: node.position.end.offset ?? markdown.length,
        node
      };
      return EXIT;
    }
  });

  return manifestNode;
};

export const extractLedgerSubheadings = (markdown: string): string[] => {
  const ledgerSections = collectLedgerSections(markdown);
  return [...new Set(ledgerSections.flat())];
};

const normalizeLedgerLabel = (value: string): string =>
  value.trim().replace(/:$/, '').toLowerCase();

const canonicalLedgerHeading = (value: string): RequiredLedgerSubheading | null =>
  LEDGER_HEADING_BY_NORMALIZED.get(normalizeLedgerLabel(value)) ?? null;

const collectSemanticLedgerLabels = (text: string): RequiredLedgerSubheading[] => {
  const labels: RequiredLedgerSubheading[] = [];

  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(?:[-*]\s*)?([A-Za-z]+)\s*:/);
    if (!match?.[1]) {
      continue;
    }

    const canonical = canonicalLedgerHeading(match[1]);
    if (canonical) {
      labels.push(canonical);
    }
  }

  return labels;
};

const collectLedgerSections = (markdown: string): string[][] => {
  const tree = unified().use(remarkParse).parse(markdown);
  let currentLedgerSection: string[] | null = null;
  const ledgerSections: string[][] = [];

  visit(tree, (node) => {
    if (node.type === 'heading' && node.depth === 2) {
      if (currentLedgerSection) {
        ledgerSections.push(currentLedgerSection);
      }
      currentLedgerSection = toString(node).trim().toLowerCase() === 'ledger' ? [] : null;
      return;
    }

    if (node.type === 'heading' && node.depth <= 2) {
      if (currentLedgerSection) {
        ledgerSections.push(currentLedgerSection);
        currentLedgerSection = null;
      }
      return;
    }

    if (currentLedgerSection && node.type === 'heading' && node.depth === 3) {
      const canonical = canonicalLedgerHeading(toString(node));
      currentLedgerSection.push(canonical ?? toString(node).trim());
      return;
    }

    if (
      currentLedgerSection &&
      (node.type === 'paragraph' || node.type === 'listItem')
    ) {
      currentLedgerSection.push(...collectSemanticLedgerLabels(toString(node)));
    }
  });

  if (currentLedgerSection) {
    ledgerSections.push(currentLedgerSection);
  }

  return ledgerSections;
};

export const assertLedgerSection = (markdown: string): void => {
  const ledgerSections = collectLedgerSections(markdown);
  if (ledgerSections.length === 0) {
    throw new Error('No ledger section found under a "## Ledger" heading.');
  }

  const subheadings = extractLedgerSubheadings(markdown);

  const canonicalSubheadings = new Set(
    subheadings.map((heading) => canonicalLedgerHeading(heading) ?? heading)
  );
  const missing = REQUIRED_LEDGER_SUBHEADINGS.filter((heading) => !canonicalSubheadings.has(heading));
  if (missing.length > 0) {
    throw new Error(
      `Ledger section must include the subheadings: ${missing.join(', ')}.`
    );
  }
};

export const parseManifestJson = (
  raw: string,
  lastKnownGood?: Manifest
): { manifest: Manifest; method: ManifestParseMethod } => {
  const attempts: Array<[ManifestParseMethod, () => unknown]> = [
    ['json', () => JSON.parse(raw)],
    ['jsonrepair', () => JSON.parse(jsonrepair(raw))],
    ['json5', () => JSON5.parse(raw)]
  ];

  for (const [method, parseAttempt] of attempts) {
    let candidate: unknown;
    try {
      candidate = parseAttempt();
    } catch {
      continue;
    }
    if (!isRecord(candidate)) {
      continue;
    }

    try {
      return {
        manifest: normalizeManifest(ManifestSchema.parse(candidate)),
        method
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Manifest parsed with ${method} but failed validation: ${message}`, {
        cause: error
      });
    }
  }

  if (lastKnownGood) {
    return {
      manifest: normalizeManifest(lastKnownGood),
      method: 'last-known-good'
    };
  }

  throw new Error('Unable to parse manifest JSON using JSON.parse, jsonrepair, or JSON5.');
};

export const parseManifestFromMarkdown = (markdown: string, lastKnownGood?: Manifest): ParsedManifest => {
  const block = extractManifestBlock(markdown);
  if (!block) {
    throw new Error('No manifest block found under a "## Manifest" heading.');
  }

  const parsed = parseManifestJson(block.raw, lastKnownGood);
  return {
    manifest: parsed.manifest,
    method: parsed.method,
    block
  };
};

export const parseManifestDocument = (
  markdown: string,
  options: { lastKnownGood?: Manifest } = {}
): ParsedManifestDocument => {
  const parsed = parseManifestFromMarkdown(markdown, options.lastKnownGood);
  return {
    manifest: parsed.manifest,
    recoveryMethod: parsed.method,
    block: parsed.block
  };
};

export const updateManifestInMarkdown = (markdown: string, manifest: Manifest): string => {
  const block = extractManifestBlock(markdown);
  const serialized = [
    '```json manifest',
    JSON.stringify(normalizeManifest(manifest), null, 2),
    '```'
  ].join('\n');

  if (!block) {
    const suffix = markdown.endsWith('\n') ? '' : '\n';
    return `${markdown}${suffix}\n## Manifest\n\n${serialized}\n`;
  }

  return `${markdown.slice(0, block.startOffset)}${serialized}${markdown.slice(block.endOffset)}`;
};

export const collectManifestPaths = (manifest: Manifest): string[] => {
  return [...manifest.create, ...manifest.modify, ...manifest.delete].map((entry) =>
    normalizeRelativePath(entry)
  );
};

export const findManifestOverlap = (left: Manifest, right: Manifest): string[] => {
  const leftPaths = new Set(collectManifestPaths(left));
  const rightPaths = new Set(collectManifestPaths(right));

  return [...leftPaths].filter((path) => rightPaths.has(path)).sort();
};

export const findManifestOverlaps = findManifestOverlap;
