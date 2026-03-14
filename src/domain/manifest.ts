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

    if (underManifestHeading && node.type === 'code' && node.lang === 'json' && node.position) {
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
    try {
      return {
        manifest: normalizeManifest(ManifestSchema.parse(parseAttempt())),
        method
      };
    } catch {
      continue;
    }
  }

  if (lastKnownGood) {
    return {
      manifest: normalizeManifest(ManifestSchema.parse(lastKnownGood)),
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
