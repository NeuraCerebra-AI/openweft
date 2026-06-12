import { describe, expect, it } from 'vitest';

import {
  OPENWEFT_PID_ARGV_MARKER,
  parsePidFileContent,
  serializePidFileRecord
} from '../../src/cli/pidFile.js';

describe('pid file records', () => {
  it('round-trips a JSON pid record with identity metadata', () => {
    const content = serializePidFileRecord({
      pid: 4321,
      startedAt: '2026-06-11T10:00:00.000Z',
      argvMarker: OPENWEFT_PID_ARGV_MARKER,
      processStartTime: 'Wed Jun 10 09:00:00 2026'
    });

    expect(parsePidFileContent(content)).toEqual({
      kind: 'json',
      record: {
        pid: 4321,
        startedAt: '2026-06-11T10:00:00.000Z',
        argvMarker: 'openweft',
        processStartTime: 'Wed Jun 10 09:00:00 2026'
      }
    });
  });

  it('parses legacy bare-number pid files as legacy records', () => {
    expect(parsePidFileContent('4321\n')).toEqual({ kind: 'legacy', pid: 4321 });
    expect(parsePidFileContent('  77  ')).toEqual({ kind: 'legacy', pid: 77 });
  });

  it('treats unparsable pid files as invalid', () => {
    expect(parsePidFileContent('')).toEqual({ kind: 'invalid' });
    expect(parsePidFileContent('not-a-pid')).toEqual({ kind: 'invalid' });
    expect(parsePidFileContent('{"pid":"nope"}')).toEqual({ kind: 'invalid' });
    expect(parsePidFileContent('-5')).toEqual({ kind: 'invalid' });
    expect(parsePidFileContent('{"pid":0}')).toEqual({ kind: 'invalid' });
  });

  it('preserves a null process start time for platforms without ps', () => {
    const parsed = parsePidFileContent(
      serializePidFileRecord({
        pid: 99,
        startedAt: '2026-06-11T10:00:00.000Z',
        argvMarker: OPENWEFT_PID_ARGV_MARKER,
        processStartTime: null
      })
    );

    expect(parsed.kind).toBe('json');
    if (parsed.kind === 'json') {
      expect(parsed.record.processStartTime).toBeNull();
    }
  });
});
