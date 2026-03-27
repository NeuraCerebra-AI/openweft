import { describe, it, expect } from 'vitest';
import { formatTime, getStatusIcon } from '../../src/ui/utils.js';

describe('formatTime', () => {
  it('formats seconds into m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(83)).toBe('1:23');
    expect(formatTime(600)).toBe('10:00');
  });
});

describe('getStatusIcon', () => {
  it('cycles spinner frames for running', () => {
    expect(getStatusIcon('running', 0).icon).toBe('⠋');
    expect(getStatusIcon('running', 1).icon).toBe('⠙');
    expect(getStatusIcon('running', 9).icon).toBe('⠏');
    expect(getStatusIcon('running', 10).icon).toBe('⠋');
  });

  it('returns checkmark for completed', () => {
    const result = getStatusIcon('completed');
    expect(result.icon).toBe('✔');
  });

  it('returns cross for failed', () => {
    const result = getStatusIcon('failed');
    expect(result.icon).toBe('✘');
  });

  it('returns circle for queued', () => {
    const result = getStatusIcon('queued');
    expect(result.icon).toBe('◌');
  });

  it('returns warning for approval', () => {
    const result = getStatusIcon('approval');
    expect(result.icon).toBe('⚑');
  });
});
