import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execFileSync } from 'node:child_process';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const expectBinaryAvailable = (() => {
  try {
    execFileSync('which', ['expect'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const wizardInputScript = path.join(repoRoot, 'scripts', 'wizard-input.exp');
const recordDemoScript = path.join(repoRoot, 'scripts', 'record-demo.sh');
const fakeOpenweftFixture = path.join(repoRoot, 'tests', 'fixtures', 'wizard', 'fake-openweft.mjs');

const cleanupTargets: string[] = [];

const readJsonLines = async (filePath: string) => {
  const content = await readFile(filePath, 'utf8');
  return content
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

afterEach(async () => {
  await Promise.all(
    cleanupTargets.splice(0).map(async (target) => {
      await rm(target, { recursive: true, force: true });
    }),
  );
});

describe('wizard recording pipeline', () => {
  it('matches the Add More text-input mode on the exact submit/cancel footer', async () => {
    const script = await readFile(wizardInputScript, 'utf8');

    expect(script).toContain('"Enter submit · Esc cancel"');
    expect(script).not.toMatch(/\n\s+"submit"\s+\{/u);
    expect(script.match(/typewrite "openweft" 60/gu)).toHaveLength(2);
    expect(script).toContain('proc typewrite_visible {text {delay 55}}');
    expect(script).toContain('typewrite_visible "add dark mode with system preference detection" 60');
    expect(script).toContain('typewrite_visible "refactor auth middleware for oauth2 support" 60');
    expect(script).toContain('"Optional: Superpowers" {');
    expect(script).toContain('log_user 0');
    expect(script.match(/log_user 0/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(script.match(/log_user 1/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(script).toContain('send -- "stty cols 100 rows 24 -echo\\r"');
    expect(script).toContain('-re {\\n[^\\n]*›[^\\n]*Claude}');
    expect(script).toContain('"refactor auth middleware for oauth2 support" {');
    expect(script).toContain('"help" {');
    expect(script).toContain('send -- "s"');
    expect(script).toContain('"active 1" {');
    expect(script).toContain('TIMEOUT: Claude backend selection did not become visible');
    expect(script).toContain('pause 4000');
  });

  it('records with compatible asciinema output and stable SVG generation flags', async () => {
    const script = await readFile(recordDemoScript, 'utf8');

    expect(script).toContain('--output-format asciicast-v2');
    expect(script).toContain('export TERM="xterm-256color"');
    expect(script).toContain('export BASH_SILENCE_DEPRECATION_WARNING=1');
    expect(script).toContain('wizard.raw.cast');
    expect(script).toContain('npx tsx "$PROJECT_ROOT/scripts/normalize-cast.ts"');
    expect(script).toContain('cp "$OUTPUT_DIR/wizard-dark.svg" "$OUTPUT_DIR/wizard-light.svg"');
    expect(script).toContain('rm -f "$CAST_PATH" "$RAW_CAST_PATH"');
  });

  it.skipIf(!expectBinaryAvailable)(
    'drives the full wizard flow and dashboard against a fake interactive CLI',
    async () => {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-wizard-recording-'));
      cleanupTargets.push(tempRoot);

      const binDir = path.join(tempRoot, 'bin');
      const stateDir = path.join(tempRoot, 'state');
      const logPath = path.join(tempRoot, 'wizard-log.jsonl');
      await mkdir(binDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });

      const openweftWrapper = path.join(binDir, 'openweft');
      await writeFile(
        openweftWrapper,
        `#!/bin/bash
exec "${process.execPath}" "${fakeOpenweftFixture}"
`,
        'utf8',
      );
      await chmod(openweftWrapper, 0o755);

      const result = await execa('expect', [wizardInputScript], {
        cwd: tempRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          PS1: '$ ',
          TERM: 'xterm-256color',
          OPENWEFT_RECORD_PACE_SCALE: '0.02',
          WIZARD_RECORD_TEST_LOG: logPath,
          WIZARD_RECORD_TEST_STATE_DIR: stateDir,
        },
        reject: false,
        timeout: 40_000,
      });

      expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain('TIMEOUT:');

      const events = await readJsonLines(logPath);
      expect(events.filter((entry) => entry.event === 'invocation')).toHaveLength(2);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: 'welcome-continue' }),
          expect.objectContaining({ event: 'backend-down' }),
          expect.objectContaining({ event: 'backend-confirm' }),
          expect.objectContaining({ event: 'model-confirm' }),
          expect.objectContaining({ event: 'effort-down' }),
          expect.objectContaining({ event: 'effort-confirm' }),
          expect.objectContaining({ event: 'superpowers-skip' }),
          expect.objectContaining({
            event: 'feature-one-submit',
            received: 'add dark mode with system preference detection',
          }),
          expect.objectContaining({ event: 'add-more-down' }),
          expect.objectContaining({ event: 'add-more-confirm' }),
          expect.objectContaining({
            event: 'feature-two-submit',
            received: 'refactor auth middleware for oauth2 support',
          }),
          expect.objectContaining({ event: 'add-more-continue' }),
          expect.objectContaining({ event: 'launch-down' }),
          expect.objectContaining({ event: 'launch-confirm' }),
          expect.objectContaining({ event: 'dashboard-start' }),
          expect.objectContaining({ event: 'dashboard-running-rendered' }),
        ]),
      );
    },
    45_000,
  );
});
