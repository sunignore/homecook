import { describe, expect, it } from 'vitest';
import { addDays, formatDayLabel, startOfWeek, weekDates } from './date';

describe('addDays', () => {
  it('rolls over a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('goes backwards', () => {
    expect(addDays('2026-09-07', -7)).toBe('2026-08-31');
  });
});

describe('startOfWeek', () => {
  it('returns the same date when it is already Monday', () => {
    expect(startOfWeek('2026-09-07')).toBe('2026-09-07'); // a Monday
  });

  it('goes back to Monday from mid-week', () => {
    expect(startOfWeek('2026-09-10')).toBe('2026-09-07'); // Thursday
  });

  it('treats Sunday as the end of its week, not the start of the next', () => {
    expect(startOfWeek('2026-09-13')).toBe('2026-09-07'); // Sunday
  });
});

describe('weekDates', () => {
  it('lists seven consecutive dates starting at the given day', () => {
    expect(weekDates('2026-09-07')).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
  });
});

describe('formatDayLabel', () => {
  it('formats a local date without shifting to UTC', () => {
    expect(formatDayLabel('2026-09-07')).toContain('7');
  });
});
