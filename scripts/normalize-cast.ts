import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const CLEAR_SCREEN = '\u001b[2J\u001b[3J\u001b[H';
const CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const OSC_SEQUENCE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/gu;
const SGR_SEQUENCE = /\u001b\[[0-?]*[ -/]*m/gu;
const SINGLE_ESCAPE_SEQUENCE = /\u001b[@-_]/gu;
const MIN_LEADING_IDLE_TO_RETIME = 0.5;
const TRAILING_REPAINT_MAX_GAP = 0.25;
const TRAILING_REPAINT_MIN_RATIO = 0.85;

const hasVisibleContent = (output: string): boolean =>
  output
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(SINGLE_ESCAPE_SEQUENCE, '')
    .replace(/[\r\n]/gu, '')
    .trim()
    .length > 0;

const getVisibleContentLength = (output: string): number =>
  output
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(SINGLE_ESCAPE_SEQUENCE, '')
    .replace(/[\r\n]/gu, '')
    .trim()
    .length;

const hasUnsafeTerminalControl = (output: string): boolean => {
  const withoutSafeSequences = output
    .replace(OSC_SEQUENCE, '')
    .replace(SGR_SEQUENCE, '');

  return (
    /\u001b\[[0-?]*[ -/]*[@-~]/u.test(withoutSafeSequences)
    || /\u001b[@-_]/u.test(withoutSafeSequences)
    || /\u001b/u.test(withoutSafeSequences)
  );
};

const isSafePaintContinuation = (output: string): boolean =>
  hasVisibleContent(output) && !hasUnsafeTerminalControl(output);

const splitOutputOnClearScreens = (output: string): string[] => {
  const segments: string[] = [];
  let cursor = 0;

  while (cursor < output.length) {
    const nextClearScreen = output.indexOf(CLEAR_SCREEN, cursor);

    if (nextClearScreen === -1) {
      segments.push(output.slice(cursor));
      break;
    }

    if (nextClearScreen > cursor) {
      segments.push(output.slice(cursor, nextClearScreen));
    }

    const followingClearScreen = output.indexOf(CLEAR_SCREEN, nextClearScreen + CLEAR_SCREEN.length);
    if (followingClearScreen === -1) {
      segments.push(output.slice(nextClearScreen));
      break;
    }

    segments.push(output.slice(nextClearScreen, followingClearScreen));
    cursor = followingClearScreen;
  }

  return segments.filter((segment) => segment.length > 0);
};

const trimTrailingIncompleteRepaint = (
  events: Array<[number, string, string]>,
): Array<[number, string, string]> => {
  const outputIndices = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event[1] === 'o')
    .map(({ index }) => index);

  const lastIndex = outputIndices.at(-1);
  const previousIndex = outputIndices.at(-2);

  if (lastIndex === undefined || previousIndex === undefined) {
    return events;
  }

  const lastEvent = events[lastIndex];
  const previousEvent = events[previousIndex];

  if (lastEvent === undefined || previousEvent === undefined) {
    return events;
  }

  if (!lastEvent[2].startsWith(CLEAR_SCREEN) || !previousEvent[2].startsWith(CLEAR_SCREEN)) {
    return events;
  }

  if (lastEvent[0] - previousEvent[0] > TRAILING_REPAINT_MAX_GAP) {
    return events;
  }

  const previousVisibleLength = getVisibleContentLength(previousEvent[2]);
  const lastVisibleLength = getVisibleContentLength(lastEvent[2]);

  if (previousVisibleLength === 0) {
    return events;
  }

  if (lastVisibleLength >= previousVisibleLength * TRAILING_REPAINT_MIN_RATIO) {
    return events;
  }

  return events.filter((_, index) => index !== lastIndex);
};

const rebaseToFirstVisibleOutput = (events: Array<[number, string, string]>): {
  rebasedEvents: Array<[number, string, string]>;
  leadingIdle: number;
} => {
  const firstVisibleOutput = events.find((event) => event[1] === 'o');

  if (firstVisibleOutput === undefined || firstVisibleOutput[0] < MIN_LEADING_IDLE_TO_RETIME) {
    return { rebasedEvents: events, leadingIdle: 0 };
  }

  const leadingIdle = firstVisibleOutput[0];
  const rebasedEvents = events.map(([time, kind, output]) => [
    Math.max(0, Number((time - leadingIdle).toFixed(6))),
    kind,
    output
  ] as [number, string, string]);

  return { rebasedEvents, leadingIdle };
};

const extendFinalVisibleFrame = (
  events: Array<[number, string, string]>,
  holdDuration: number,
): Array<[number, string, string]> => {
  if (holdDuration <= 0) {
    return events;
  }

  if (events.length === 0) {
    return events;
  }

  const lastVisibleIndex = [...events].map((event, index) => ({ event, index })).reverse()
    .find(({ event }) => event[1] === 'o')?.index;

  if (lastVisibleIndex === undefined) {
    return events;
  }

  const lastVisibleEvent = events[lastVisibleIndex];

  if (lastVisibleEvent === undefined) {
    return events;
  }

  const [lastVisibleTime, , lastVisibleOutput] = lastVisibleEvent;
  const extendedTime = Number((lastVisibleTime + holdDuration).toFixed(6));
  const duplicatedFrame: [number, string, string] = [extendedTime, 'o', lastVisibleOutput];

  return [
    ...events.slice(0, lastVisibleIndex + 1),
    duplicatedFrame,
    ...events.slice(lastVisibleIndex + 1),
  ];
};

export function sanitizeAsciicastV2(content: string): string {
  const lines = content
    .split('\n')
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return '';
  }

  const [headerLine, ...eventLines] = lines;
  const sanitizedEvents: Array<[number, string, string]> = [];
  let pendingFrame: [number, string, string] | null = null;

  const flushPendingFrame = () => {
    if (pendingFrame === null) {
      return;
    }

    sanitizedEvents.push(pendingFrame);
    pendingFrame = null;
  };

  for (const line of eventLines) {
    const event = JSON.parse(line) as [number, string, string];
    const [time, kind, output] = event;

    if (kind !== 'o') {
      flushPendingFrame();
      sanitizedEvents.push(event);
      continue;
    }

    for (const chunk of splitOutputOnClearScreens(output)) {
      const chunkEvent: [number, string, string] = [time, kind, chunk];

      if (chunk.startsWith(CLEAR_SCREEN)) {
        flushPendingFrame();
        pendingFrame = chunkEvent;
        continue;
      }

      if (!hasVisibleContent(chunk)) {
        continue;
      }

      if (pendingFrame !== null && isSafePaintContinuation(chunk)) {
        pendingFrame = [pendingFrame[0], pendingFrame[1], `${pendingFrame[2]}${chunk}`];
        continue;
      }

      flushPendingFrame();
      sanitizedEvents.push(chunkEvent);
    }
  }

  flushPendingFrame();
  const trimmedEvents = trimTrailingIncompleteRepaint(sanitizedEvents);
  const { rebasedEvents, leadingIdle } = rebaseToFirstVisibleOutput(trimmedEvents);
  const retimedEvents = extendFinalVisibleFrame(rebasedEvents, leadingIdle);
  const sanitizedLines = [headerLine, ...retimedEvents.map((event) => JSON.stringify(event))];
  return `${sanitizedLines.join('\n')}\n`;
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;

  if (inputPath === undefined || outputPath === undefined) {
    throw new Error('Usage: tsx scripts/normalize-cast.ts <input.cast> <output.cast>');
  }

  const input = await readFile(inputPath, 'utf8');
  const sanitized = sanitizeAsciicastV2(input);
  await writeFile(outputPath, sanitized, 'utf8');
}

const scriptEntry = process.argv[1];

if (scriptEntry !== undefined && import.meta.url === pathToFileURL(scriptEntry).href) {
  await main();
}
