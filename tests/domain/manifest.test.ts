import { describe, expect, it } from 'vitest';

import {
  findManifestOverlap,
  parseManifestFromMarkdown,
  parseManifestJson,
  updateManifestInMarkdown
} from '../../src/domain/manifest.js';

describe('manifest', () => {
  const markdown = `# Plan

## Manifest

\`\`\`json manifest
{
  "create": ["src/auth/login.ts"],
  "modify": ["src/utils/helpers.ts"],
  "delete": []
}
\`\`\`
`;

  it('extracts and parses a manifest from markdown', () => {
    const parsed = parseManifestFromMarkdown(markdown);

    expect(parsed.manifest.create).toEqual(['src/auth/login.ts']);
    expect(parsed.method).toBe('json');
  });

  it('repairs malformed JSON manifests', () => {
    const repaired = parseManifestJson(`{create:['src/a.ts'], modify:[], delete:[],}`);
    expect(repaired.method).toBe('jsonrepair');
  });

  it('updates manifest blocks in place', () => {
    const updated = updateManifestInMarkdown(markdown, {
      create: ['src/new.ts'],
      modify: [],
      delete: []
    });

    expect(updated).toContain('"create": [\n    "src/new.ts"\n  ]');
  });

  it('detects overlapping manifest paths', () => {
    expect(
      findManifestOverlap(
        {
          create: ['src/auth/login.ts'],
          modify: [],
          delete: []
        },
        {
          create: [],
          modify: ['./src/auth/login.ts'],
          delete: []
        }
      )
    ).toEqual(['src/auth/login.ts']);
  });
});

