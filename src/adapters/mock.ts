import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { slugifyFeatureRequest } from '../domain/featureIds.js';
import { parseManifestDocument, type Manifest } from '../domain/manifest.js';

import type { AgentAdapter, AdapterCommandSpec, AdapterTurnRequest, AdapterUsage } from './types.js';

import { createAdapterFailure, createAdapterSuccess } from './shared.js';

export interface MockAdapterFixture {
  finalMessage?: string;
  sessionId?: string | null;
  model?: string;
  usage?: Partial<AdapterUsage>;
  error?: string;
}

export interface MockAdapterOptions {
  fixtures?: Record<string, MockAdapterFixture>;
}

const defaultUsage = (): AdapterUsage => ({
  inputTokens: 120,
  outputTokens: 48,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  totalCostUsd: null,
  raw: {}
});

const buildMockSessionId = (request: AdapterTurnRequest): string => {
  return request.sessionId ?? `mock-${request.featureId}-${request.stage}`;
};

const isMetaInstruction = (line: string): boolean => {
  const trimmed = line.trim().toUpperCase();
  return trimmed.startsWith('CRITICAL INSTRUCTION') ||
    trimmed.startsWith('IMPORTANT:') ||
    trimmed.startsWith('DO NOT');
};

const buildDefaultManifest = (request: AdapterTurnRequest): Manifest => {
  const seedLine =
    request.prompt
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0 && !isMetaInstruction(line))
      ?.trim() ?? request.featureId;

  return {
    create: [`src/features/${request.featureId}-${slugifyFeatureRequest(seedLine)}.ts`],
    modify: [],
    delete: []
  };
};

const buildMockPlanMarkdown = (request: AdapterTurnRequest): string => {
  const manifest = buildDefaultManifest(request);

  return `# Feature Plan: ${request.featureId}

## Request

${request.prompt.trim()}

## Steps

1. Inspect the current repository area for this request.
2. Implement the requested change in the smallest safe slice.
3. Run targeted validation before completion.

## Manifest

\`\`\`json manifest
${JSON.stringify(manifest, null, 2)}
\`\`\`
`;
};

const extractPlanMarkdownFromExecutionPrompt = (prompt: string): string => {
  const match = prompt.match(/=== PLAN START ===\n([\s\S]*?)\n=== PLAN END ===/);
  return match?.[1]?.trim() ?? prompt;
};

const applyManifestToWorkspace = async (cwd: string, manifest: Manifest): Promise<void> => {
  for (const relativePath of manifest.create) {
    const targetPath = path.join(cwd, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(
      targetPath,
      [
        `export const generated_${relativePath.replace(/[^a-z0-9]+/gi, '_')} = {`,
        `  path: ${JSON.stringify(relativePath)},`,
        `  createdBy: 'openweft-mock'`,
        '};',
        ''
      ].join('\n'),
      'utf8'
    );
  }

  for (const relativePath of manifest.modify) {
    const targetPath = path.join(cwd, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    const existing = await readFile(targetPath, 'utf8').catch(() => '');
    const suffix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
    await writeFile(
      targetPath,
      `${existing}${suffix}// modified by openweft-mock\n`,
      'utf8'
    );
  }

  for (const relativePath of manifest.delete) {
    await rm(path.join(cwd, relativePath), { force: true });
  }
};

const walkFiles = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
};

const resolveMockConflicts = async (cwd: string): Promise<void> => {
  const files = await walkFiles(cwd);

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8').catch(() => '');
    if (!content.includes('<<<<<<<') || !content.includes('>>>>>>>')) {
      continue;
    }

    const resolved = content
      .replace(/<<<<<<<[^\n]*\n/g, '')
      .replace(/\n=======\n/g, '\n')
      .replace(/\n>>>>>>>[^\n]*\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');

    await writeFile(filePath, resolved, 'utf8');
  }
};

const buildDefaultFinalMessage = (request: AdapterTurnRequest): string => {
  switch (request.stage) {
    case 'planning-s1':
      return `Runtime-generated Prompt B for ${request.featureId}`;
    case 'planning-s2':
      return buildMockPlanMarkdown(request);
    case 'execution':
      return `Mock execution completed for ${request.featureId}`;
    case 'adjustment':
      return `Mock plan adjustment reviewed for ${request.featureId}`;
    case 'conflict-resolution':
      return `Mock conflict resolution completed for ${request.featureId}`;
    default:
      return `Mock ${request.stage} response for ${request.featureId}`;
  }
};

export class MockAgentAdapter implements AgentAdapter {
  readonly backend = 'mock' as const;

  private readonly fixtures: Record<string, MockAdapterFixture>;

  constructor(options: MockAdapterOptions = {}) {
    this.fixtures = options.fixtures ?? {};
  }

  buildCommand(request: AdapterTurnRequest): AdapterCommandSpec {
    return {
      command: 'mock',
      args: ['run', request.stage],
      cwd: request.cwd,
      input: request.prompt
    };
  }

  async runTurn(request: AdapterTurnRequest) {
    const command = this.buildCommand(request);
    const fixture =
      this.fixtures[request.stage] ??
      this.fixtures.default ??
      {};

    if (fixture.error) {
      return createAdapterFailure({
        backend: this.backend,
        request,
        command,
        execution: {
          stdout: '',
          stderr: fixture.error,
          exitCode: 1
        },
        sessionId: buildMockSessionId(request)
      });
    }

    if (request.stage === 'execution') {
      const parsedPlan = parseManifestDocument(extractPlanMarkdownFromExecutionPrompt(request.prompt));
      await applyManifestToWorkspace(request.cwd, parsedPlan.manifest);
    }

    if (request.stage === 'conflict-resolution') {
      await resolveMockConflicts(request.cwd);
    }

    const usage = {
      ...defaultUsage(),
      ...fixture.usage
    };
    const model = fixture.model ?? request.model;
    const finalMessage = fixture.finalMessage ?? buildDefaultFinalMessage(request);
    const sessionId = fixture.sessionId ?? buildMockSessionId(request);
    const execution = {
      stdout: JSON.stringify({
        sessionId,
        finalMessage,
        usage
      }),
      stderr: '',
      exitCode: 0
    };

    return createAdapterSuccess({
      backend: this.backend,
      request,
      sessionId,
      finalMessage,
      model,
      usage,
      command,
      execution
    });
  }
}
