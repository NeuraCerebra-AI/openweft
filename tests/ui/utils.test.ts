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
  it('returns spinner for running', () => {
    const result = getStatusIcon('running');
    expect(result.icon).toBe('⠋');
  });

  it('returns checkmark for completed', () => {
    const result = getStatusIcon('completed');
    expect(result.icon).toBe('✓');
  });

  it('returns cross for failed', () => {
    const result = getStatusIcon('failed');
    expect(result.icon).toBe('✗');
  });

  it('returns circle for queued', () => {
    const result = getStatusIcon('queued');
    expect(result.icon).toBe('○');
  });

  it('returns warning for approval', () => {
    const result = getStatusIcon('approval');
    expect(result.icon).toBe('⚠');
  });
});
