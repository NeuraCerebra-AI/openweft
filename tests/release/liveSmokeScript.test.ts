import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type LiveSmokeHelpers = {
  parseLiveSmokeTimeoutMs: (rawValue: string | undefined) => number | null;
  printSmokeDiagnostics: (input: {
    tempRepo: string;
    writeLine: (line: string) => void;
  }) => Promise<void>;
  printSmokeDiagnosticsSafely: (input: {
    tempRepo: string;
    writeLine: (line: string) => void;
    printDiagnostics?: (input: {
      tempRepo: string;
      writeLine: (line: string) => void;
    }) => Promise<void>;
  }) => Promise<void>;
};

const loadHelpers = async (): Promise<LiveSmokeHelpers> => {
  return (await import(new URL('../../scripts/live-smoke-helpers.mjs', import.meta.url).href)) as LiveSmokeHelpers;
};

const createSmokeRepo = async (): Promise<string> => {
  const tempRepo = await mkdtemp(path.join(os.tmpdir(), 'openweft-live-smoke-helper-test-'));
  await mkdir(path.join(tempRepo, '.openweft'), { recursive: true });
  return tempRepo;
};

describe('live smoke script helpers', () => {
  it('asks live smoke Work Briefs to preserve exact user request payloads', async () => {
    const script = await readFile(new URL('../../scripts/live-smoke.mjs', import.meta.url), 'utf8');

    expect(script).toContain(
      'repeats the full user request verbatim, including the target path and any exact requested file content after a colon'
    );
  });

  it('strictly parses timeout values as full positive safe integer strings', async () => {
    const { parseLiveSmokeTimeoutMs } = await loadHelpers();

    expect(parseLiveSmokeTimeoutMs(undefined)).toBeNull();
    expect(parseLiveSmokeTimeoutMs('1000')).toBe(1000);
    expect(parseLiveSmokeTimeoutMs('001000')).toBe(1000);
    expect(parseLiveSmokeTimeoutMs('2147483647')).toBe(2147483647);

    for (const invalid of [
      '',
      '   ',
      '0',
      '-1',
      '1.5',
      '100abc',
      'abc100',
      '2147483648',
      `${Number.MAX_SAFE_INTEGER}`
    ]) {
      expect(() => parseLiveSmokeTimeoutMs(invalid)).toThrow(
        /OPENWEFT_LIVE_SMOKE_TIMEOUT_MS must be a positive integer/
      );
    }
  });

  it('prints malformed checkpoint diagnostics without throwing', async () => {
    const { printSmokeDiagnostics } = await loadHelpers();
    const tempRepo = await createSmokeRepo();
    const lines: string[] = [];

    await writeFile(path.join(tempRepo, '.openweft', 'checkpoint.json'), '{"status":', 'utf8');

    await expect(
      printSmokeDiagnostics({
        tempRepo,
        writeLine: (line) => lines.push(line)
      })
    ).resolves.toBeUndefined();

    expect(lines.some((line) => line.includes('Checkpoint summary: failed to parse checkpoint.json:'))).toBe(
      true
    );
  });

  it('summarizes valid and malformed audit lines without throwing', async () => {
    const { printSmokeDiagnostics } = await loadHelpers();
    const tempRepo = await createSmokeRepo();
    const lines: string[] = [];

    await writeFile(
      path.join(tempRepo, '.openweft', 'audit-trail.jsonl'),
      [
        JSON.stringify({
          timestamp: '2026-06-06T00:00:00.000Z',
          event: 'agent.turn.completed',
          message: 'done',
          data: { featureId: '001', stage: 'execution' }
        }),
        'null',
        '"not-an-object"',
        '{"event":',
        JSON.stringify({ event: 'run.failed', message: 'failed' })
      ].join('\n'),
      'utf8'
    );

    await expect(
      printSmokeDiagnostics({
        tempRepo,
        writeLine: (line) => lines.push(line)
      })
    ).resolves.toBeUndefined();

    const output = lines.join('\n');
    expect(output).toContain('Recent audit events:');
    expect(output).toContain('agent.turn.completed');
    expect(output).toContain('run.failed');
    expect(output).toContain('"malformedLineCount": 3');
    expect(output).toContain('not an object');
    expect(output).toContain('{\\"event\\":');
  });

  it('summarizes valid and malformed cost lines without throwing', async () => {
    const { printSmokeDiagnostics } = await loadHelpers();
    const tempRepo = await createSmokeRepo();
    const lines: string[] = [];

    await writeFile(
      path.join(tempRepo, '.openweft', 'costs.jsonl'),
      [
        JSON.stringify({
          inputTokens: 10,
          outputTokens: 5,
          estimatedCostUsd: 0.1234567
        }),
        JSON.stringify({
          inputTokens: 'not-a-number',
          outputTokens: Number.POSITIVE_INFINITY,
          estimatedCostUsd: Number.NaN
        }),
        'null',
        '["not", "an", "object"]',
        '{"inputTokens":'
      ].join('\n'),
      'utf8'
    );

    await expect(
      printSmokeDiagnostics({
        tempRepo,
        writeLine: (line) => lines.push(line)
      })
    ).resolves.toBeUndefined();

    const output = lines.join('\n');
    expect(output).toContain('Cost summary:');
    expect(output).toContain('"turns": 2');
    expect(output).toContain('"inputTokens": 10');
    expect(output).toContain('"outputTokens": 5');
    expect(output).toContain('"malformedLineCount": 3');
    expect(output).toContain('not an object');
    expect(output).toContain('{\\"inputTokens\\":');
  });

  it('protects the original smoke failure from diagnostics failures', async () => {
    const { printSmokeDiagnosticsSafely } = await loadHelpers();
    const lines: string[] = [];

    await expect(
      printSmokeDiagnosticsSafely({
        tempRepo: '/tmp/not-used',
        writeLine: (line) => lines.push(line),
        printDiagnostics: async () => {
          throw new Error('diagnostics blew up');
        }
      })
    ).resolves.toBeUndefined();

    expect(lines).toEqual(['Smoke diagnostics failed: diagnostics blew up']);
  });
});
