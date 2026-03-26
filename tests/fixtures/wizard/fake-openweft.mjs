import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const FEATURE_ONE = 'add dark mode with system preference detection';
const FEATURE_TWO = 'refactor auth middleware for oauth2 support';
const DOWN = '\u001B[B';

const logPath = process.env.WIZARD_RECORD_TEST_LOG;
const stateDir = process.env.WIZARD_RECORD_TEST_STATE_DIR;

if (!logPath || !stateDir) {
  throw new Error('WIZARD_RECORD_TEST_LOG and WIZARD_RECORD_TEST_STATE_DIR must be set.');
}

process.on('SIGHUP', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

const sessionStart = Date.now();

const logEvent = async (event, details = {}) => {
  await appendFile(
    logPath,
    `${JSON.stringify({ event, atMs: Date.now() - sessionStart, ...details })}\n`,
    'utf8',
  );
};

const pause = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const writeScreen = async (text) => {
  process.stdout.write(text);
  await logEvent('screen', { text });
};

const nextInvocation = async () => {
  await mkdir(stateDir, { recursive: true });
  const counterPath = path.join(stateDir, 'invocation.txt');

  let current = 0;
  try {
    current = Number.parseInt(await readFile(counterPath, 'utf8'), 10);
  } catch {
    current = 0;
  }

  const next = Number.isFinite(current) ? current + 1 : 1;
  await writeFile(counterPath, `${String(next)}\n`, 'utf8');
  return next;
};

class InputReader {
  #buffer = '';

  #waiters = [];

  constructor() {
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.setRawMode?.(true);
    process.stdin.on('data', (chunk) => {
      this.#buffer += chunk;
      void logEvent('input-chunk', { chunk });
      this.#flush();
    });
  }

  close() {
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
  }

  async readExact(expected, description) {
    return this.#waitFor(
      () => {
        if (!this.#buffer.startsWith(expected)) {
          return null;
        }

        this.#buffer = this.#buffer.slice(expected.length);
        return expected;
      },
      description,
    );
  }

  async readLine(description) {
    return this.#waitFor(() => {
      const newlineIndex = this.#buffer.search(/[\r\n]/u);
      if (newlineIndex === -1) {
        return null;
      }

      const value = this.#buffer.slice(0, newlineIndex);
      const newlineLength =
        this.#buffer[newlineIndex] === '\r' && this.#buffer[newlineIndex + 1] === '\n' ? 2 : 1;
      this.#buffer = this.#buffer.slice(newlineIndex + newlineLength);
      return value;
    }, description);
  }

  #flush() {
    for (const waiter of [...this.#waiters]) {
      const matched = waiter.tryResolve();
      if (!matched) {
        continue;
      }

      clearTimeout(waiter.timer);
      this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
      waiter.resolve(matched);
    }
  }

  async #waitFor(tryResolve, description) {
    const immediate = tryResolve();
    if (immediate !== null) {
      return immediate;
    }

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((waiter) => waiter.timer !== timer);
        reject(
          new Error(
            `Timed out waiting for ${description}. Buffered input: ${JSON.stringify(this.#buffer)}`,
          ),
        );
      }, 5_000);

      this.#waiters.push({
        timer,
        resolve,
        tryResolve: () => tryResolve(),
      });
    });
  }
}

const expectExact = async (reader, expected, description, event) => {
  const received = await reader.readExact(expected, description);
  await logEvent(event, { received });
};

const expectFeature = async (reader, expected, event, renderValue) => {
  const characters = [...expected];
  let received = '';

  for (const character of characters) {
    received += await reader.readExact(character, `${event} character ${JSON.stringify(character)}`);
    await renderValue(received);
    await logEvent(`${event}-progress`, { received });
  }

  await expectExact(reader, '\r', `${event} Enter`, `${event}-enter`);
  await logEvent(event, { received });
};

const renderFeatureInputFrame = async (value) => {
  await writeScreen(
    [
      'What should OpenWeft build?',
      'Type a feature request. One line, plain language. You can add more after.',
      `› ${value}█`,
      'Enter submit · ← back · Esc quit',
    ].join('\n') + '\n',
  );
};

const renderAddMoreInputFrame = async (value) => {
  await writeScreen(
    [
      'Add more?',
      '#001 add dark mode with system preference detection',
      '1 requests queued. Add another or continue to launch.',
      `› ${value}█`,
      'Enter submit · Esc cancel',
    ].join('\n') + '\n',
  );
};

const renderWizardRun = async (reader) => {
  await writeScreen(
    [
      '● ○ ○ ○ ○ ○ ○  1/7',
      '◆ openweft setup',
      '✓ Git repository detected',
      '✓ Initial commit created',
      '✓ Node.js v24.0.0',
      'Enter continue · Esc quit',
    ].join('\n') + '\n',
  );
  await expectExact(reader, '\r', 'welcome Enter', 'welcome-continue');

  await writeScreen(
    [
      '○ ● ○ ○ ○ ○ ○  2/7',
      '◆ openweft setup · backends',
      'Choose your default backend',
      '› Codex',
      '  Claude',
      '↑↓ select · Enter confirm · R retry · ← back · Esc quit',
    ].join('\n') + '\n',
  );
  await expectExact(reader, DOWN, 'backend down arrow', 'backend-down');
  await writeScreen(
    [
      '○ ● ○ ○ ○ ○ ○  2/7',
      '◆ openweft setup · backends',
      'Choose your default backend',
      '  Codex',
      '› Claude',
      '↑↓ select · Enter confirm · R retry · ← back · Esc quit',
    ].join('\n') + '\n',
  );
  await expectExact(reader, '\r', 'backend Enter', 'backend-confirm');

  await writeScreen(
    [
      'Choose the default claude model',
      '› claude-sonnet-4-6',
      '  claude-haiku-4-5',
      '  claude-opus-4-6',
      '↑↓ select · Enter confirm · R retry · ← back · Esc quit',
    ].join('\n') + '\n',
  );
  await expectExact(reader, '\r', 'model Enter', 'model-confirm');

  await writeScreen(
    [
      'Choose the default claude effort',
      'Model: claude-sonnet-4-6',
      '  low',
      '› medium',
      '  high',
      '  max',
      '↑↓ select · Enter confirm · R retry · ← back · Esc quit',
    ].join('\n') + '\n',
  );
  await expectExact(reader, DOWN, 'effort down arrow', 'effort-down');
  await expectExact(reader, '\r', 'effort Enter', 'effort-confirm');

  await writeScreen(
    [
      '○ ○ ● ○ ○ ○ ○  3/7',
      '◆ openweft setup · optional',
      'Optional: Superpowers',
      'Popular workflow toolkit for Claude, by Jesse Vincent.',
      'It installs in your local Claude agent/profile, not this repo.',
      'OpenWeft works without it. Skip is the default.',
      'After installing, start a new OpenWeft/Claude session so it is recognized.',
      'GitHub: github.com/obra/superpowers · If you already have it, ignore this note.',
      '› Skip — continue setup',
      '  Open GitHub repo in browser',
      '↑↓ select · Enter confirm · ← back · Esc quit',
    ].join('\n') + '\n',
  );
  await expectExact(reader, '\r', 'superpowers skip Enter', 'superpowers-skip');

  await writeScreen('◆ openweft setup · init\n○ ○ ○ ● ○ ○ ○  4/7\n… Initializing...\n');
  await pause(150);
  await writeScreen(
    [
      'Project initialized',
      '✓ .openweftrc.json',
      '✓ feature_requests/queue.txt',
      'Enter continue · ← back · Esc quit',
    ].join('\n') + '\n',
  );
  await expectExact(reader, '\r', 'init Enter', 'init-continue');

  await renderFeatureInputFrame('');
  await expectFeature(reader, FEATURE_ONE, 'feature-one-submit', renderFeatureInputFrame);

  await writeScreen(
    [
      'Add more?',
      '#001 add dark mode with system preference detection',
      '1 requests queued. Add another or continue to launch.',
      '› Continue to launch',
      '  Add another request',
      '↑↓ select · Enter confirm · ← back · Esc quit',
    ].join('\n') + '\n',
  );
  await expectExact(reader, DOWN, 'add-more down arrow', 'add-more-down');
  await expectExact(reader, '\r', 'add-more Enter', 'add-more-confirm');

  await renderAddMoreInputFrame('');
  await expectFeature(reader, FEATURE_TWO, 'feature-two-submit', renderAddMoreInputFrame);

  await writeScreen(
    [
      'Add more?',
      '#001 add dark mode with system preference detection',
      '#002 refactor auth middleware for oauth2 support',
      '2 requests queued. Add another or continue to launch.',
      '› Continue to launch',
      '  Add another request',
      '↑↓ select · Enter confirm · ← back · Esc quit',
    ].join('\n') + '\n',
  );
  await expectExact(reader, '\r', 'continue-to-launch Enter', 'add-more-continue');

  await writeScreen(
    [
      'Ready to start',
      '1. Create an implementation plan for each request',
      '2. Score and group by file overlap — non-conflicting work runs in parallel',
      '3. Execute each in an isolated git worktree using claude',
      '4. Merge results, re-plan remaining work, repeat until done',
      '› Start now — 2 requests queued',
      '  Exit — run openweft later to start',
      '↑↓ select · Enter confirm · ← back · Esc quit',
    ].join('\n') + '\n',
  );
  await expectExact(reader, DOWN, 'launch down arrow', 'launch-down');
  await expectExact(reader, '\r', 'launch Enter', 'launch-confirm');
}

const renderDashboardRun = async (reader) => {
  await writeScreen(
    [
      '◆ openweft │ claude · claude-sonnet-4-6 · high │ active 0 · pending 2 │ 0:00',
      '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
      '┃ ◌ add dark mode with system preference detection                                            0:00 ┃',
      '┃   Press d to remove                                                                              ┃',
      '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
      '┌──────────────────────────────────────────────────────────────────────────────────────────────────┐',
      '│ ◌ refactor auth middleware for oauth2 support                                               0:00 │',
      '└──────────────────────────────────────────────────────────────────────────────────────────────────┘',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ' NORMAL  s start m model a add d remove h history ? help',
    ].join('\n') + '\n',
  );
  await expectExact(reader, 's', 'dashboard s', 'dashboard-start');
  await writeScreen(
    [
      '◆ openweft │ claude · claude-sonnet-4-6 · high │ active 1 · pending 1 │ 0:01',
      '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
      '┃ ⠙ add dark mode with system preference detection                                            0:01 ┃',
      '┃   ▸ Preparing implementation prompt                                                           ┃',
      '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
      '┌──────────────────────────────────────────────────────────────────────────────────────────────────┐',
      '│ ◌ refactor auth middleware for oauth2 support                                               0:00 │',
      '└──────────────────────────────────────────────────────────────────────────────────────────────────┘',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ' NORMAL  a add d remove h history q stop run ? help',
    ].join('\n') + '\n',
  );
  await logEvent('dashboard-running-rendered');
  await pause(10_000);
};

const main = async () => {
  const invocation = await nextInvocation();
  await logEvent('invocation', { invocation });

  const reader = new InputReader();

  try {
    if (invocation === 1) {
      await renderWizardRun(reader);
      return;
    }

    if (invocation === 2) {
      await renderDashboardRun(reader);
      return;
    }

    throw new Error(`Unexpected invocation ${String(invocation)}.`);
  } finally {
    reader.close();
  }
};

await main();
