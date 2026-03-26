import { describe, expect, it } from 'vitest';

import {
  assertLedgerSection,
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

  it('parses a manifest from a plain json fence', () => {
    const parsed = parseManifestFromMarkdown(`## Manifest

\`\`\`json
{
  "create": [],
  "modify": ["src/plain.ts"],
  "delete": []
}
\`\`\`
`);

    expect(parsed.manifest.modify).toEqual(['src/plain.ts']);
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

  it('requires a ledger section with the expected subheadings when requested', () => {
    expect(() =>
      assertLedgerSection(`# Plan

## Manifest

\`\`\`json manifest
{
  "create": [],
  "modify": [],
  "delete": []
}
\`\`\`
`)
    ).toThrow(/Ledger/i);
  });

  it('accepts a ledger section when all required subheadings are present', () => {
    expect(() =>
      assertLedgerSection(`# Plan

## Ledger

### Constraints
- Keep the change set small.

### Assumptions
- The manifest is conservative.

### Watchpoints
- Preserve orchestrator compatibility.

### Validation
- Run targeted checks.
`)
    ).not.toThrow();
  });

  it('rejects split ledger sections that only satisfy the required headings across multiple blocks', () => {
    expect(() =>
      assertLedgerSection(`# Plan

## Ledger

### Constraints
- Keep the change set small.

### Assumptions
- The manifest is conservative.

## Manifest

\`\`\`json manifest
{
  "create": [],
  "modify": [],
  "delete": []
}
\`\`\`

## Ledger

### Watchpoints
- Preserve orchestrator compatibility.

### Validation
- Run targeted checks.
`)
    ).toThrow(/Ledger/i);
  });

  it('reports missing ledger subheadings when a ledger heading exists without the required structure', () => {
    expect(() =>
      assertLedgerSection(`# Plan

## Ledger
- Constraint: Keep the change set small.
- Assumption: The manifest is conservative.
- Watchpoint: Preserve orchestrator compatibility.
- Validation: Run targeted checks.
`)
    ).toThrow('Ledger section must include the subheadings: Constraints, Assumptions, Watchpoints, Validation.');
  });
});
