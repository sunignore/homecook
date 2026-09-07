import { beforeEach, describe, expect, it } from 'vitest';
import {
  announceRemaining,
  createTimer,
  extendTimer,
  formatDuration,
  pauseTimer,
  progress,
  remainingSeconds,
  resetTimer,
  startTimer,
  tickTimers,
  type CookTimer,
} from './timers';
import { clampStep, clearSession, loadSession, newSession, saveSession } from './session';

// Timers are pure functions of (state, now): no fake clocks, and the awkward
// cases — the tab asleep past the end, a reload mid-count — are directly
// expressible instead of being approximated by waiting.

const t0 = 1_757_000_000_000;

function running(durationSec: number, startedAt = t0): CookTimer {
  return startTimer(createTimer(0, '끓이기', durationSec, 'timer-1'), startedAt);
}

describe('remainingSeconds', () => {
  it('counts down from the absolute end time', () => {
    const timer = running(600);
    expect(remainingSeconds(timer, t0)).toBe(600);
    expect(remainingSeconds(timer, t0 + 60_000)).toBe(540);
  });

  it('never goes negative when the clock has run past the end', () => {
    // The phone was asleep for an hour on a ten-minute timer.
    expect(remainingSeconds(running(600), t0 + 3_600_000)).toBe(0);
  });

  it('holds steady while paused', () => {
    const paused = pauseTimer(running(600), t0 + 120_000);
    expect(remainingSeconds(paused, t0 + 120_000)).toBe(480);
    // Time passing while paused must not consume the timer.
    expect(remainingSeconds(paused, t0 + 900_000)).toBe(480);
  });
});

describe('start / pause / reset', () => {
  it('resumes from where it was paused rather than from the top', () => {
    const paused = pauseTimer(running(600), t0 + 120_000);
    const resumed = startTimer(paused, t0 + 500_000);

    expect(resumed.status).toBe('running');
    expect(remainingSeconds(resumed, t0 + 500_000)).toBe(480);
  });

  it('starting an already-running timer changes nothing', () => {
    const timer = running(600);
    expect(startTimer(timer, t0 + 60_000)).toBe(timer);
  });

  it('restarts a finished timer from its full duration', () => {
    const { timers } = tickTimers([running(60)], t0 + 61_000);
    const restarted = startTimer(timers[0]!, t0 + 61_000);

    expect(restarted.status).toBe('running');
    expect(remainingSeconds(restarted, t0 + 61_000)).toBe(60);
  });

  it('reset returns to the original duration', () => {
    const reset = resetTimer(pauseTimer(running(600), t0 + 120_000));
    expect(reset.status).toBe('idle');
    expect(reset.remainingSec).toBe(600);
  });
});

describe('extendTimer', () => {
  it('adds time to a running timer without restarting it', () => {
    const extended = extendTimer(running(600), 60, t0 + 120_000);
    expect(remainingSeconds(extended, t0 + 120_000)).toBe(540);
    expect(extended.status).toBe('running');
  });

  it('brings a finished timer back with the added time', () => {
    const { timers } = tickTimers([running(60)], t0 + 61_000);
    const extended = extendTimer(timers[0]!, 60, t0 + 61_000);

    expect(extended.status).toBe('paused');
    expect(remainingSeconds(extended, t0 + 61_000)).toBe(60);
  });
});

describe('tickTimers', () => {
  it('marks a timer done once its end time has passed', () => {
    const { timers, justFinished } = tickTimers([running(60)], t0 + 60_000);

    expect(timers[0]!.status).toBe('done');
    expect(justFinished).toHaveLength(1);
  });

  it('reports a timer that expired while the tab was asleep', () => {
    // Completion is derived from the clock, so nothing is missed by not ticking.
    const { justFinished } = tickTimers([running(60)], t0 + 3_600_000);
    expect(justFinished).toHaveLength(1);
  });

  it('reports each completion only once', () => {
    const first = tickTimers([running(60)], t0 + 61_000);
    const second = tickTimers(first.timers, t0 + 62_000);

    expect(first.justFinished).toHaveLength(1);
    expect(second.justFinished).toHaveLength(0);
  });

  it('runs several timers independently', () => {
    const rice = startTimer(createTimer(0, '밥', 600, 'a'), t0);
    const soup = startTimer(createTimer(1, '국', 60, 'b'), t0);

    const { timers, justFinished } = tickTimers([rice, soup], t0 + 61_000);

    expect(justFinished.map(t => t.id)).toEqual(['b']);
    expect(timers[0]!.status).toBe('running');
    expect(remainingSeconds(timers[0]!, t0 + 61_000)).toBe(539);
  });

  it('leaves paused timers alone', () => {
    const paused = pauseTimer(running(60), t0 + 10_000);
    const { justFinished } = tickTimers([paused], t0 + 3_600_000);
    expect(justFinished).toHaveLength(0);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '00:00'],
    [9, '00:09'],
    [60, '01:00'],
    [599, '09:59'],
    [3600, '1:00:00'],
    [3661, '1:01:01'],
  ])('%i seconds → %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('pads so the readout never changes width mid-count', () => {
    // A jumping readout is distracting from across the counter (design.md E9).
    expect(formatDuration(65)).toHaveLength(formatDuration(605).length);
  });

  it('clamps a negative value rather than printing a minus sign', () => {
    expect(formatDuration(-5)).toBe('00:00');
  });
});

describe('progress', () => {
  it('runs from 0 to 1 over the duration', () => {
    const timer = running(100);
    expect(progress(timer, t0)).toBe(0);
    expect(progress(timer, t0 + 50_000)).toBeCloseTo(0.5, 1);
    expect(progress(timer, t0 + 100_000)).toBe(1);
  });

  it('treats a zero-length timer as complete instead of dividing by zero', () => {
    expect(progress(createTimer(0, 'x', 0), t0)).toBe(1);
  });
});

describe('announceRemaining', () => {
  it.each([
    [90, '1분 30초 남음'],
    [120, '2분 남음'],
    [45, '45초 남음'],
  ])('%i seconds → %s', (seconds, expected) => {
    expect(announceRemaining(seconds)).toBe(expected);
  });
});

describe('session persistence', () => {
  const steps = [
    { text: '볶는다', durationSec: 300 },
    { text: '한소끔 끓인다' },
    { text: '끓인다', durationSec: 900 },
  ];

  beforeEach(() => {
    clearSession();
  });

  it('creates a timer only for steps that have a duration', () => {
    const session = newSession('r-1', steps, t0);
    expect(session.timers).toHaveLength(2);
    expect(session.timers.map(t => t.stepIndex)).toEqual([0, 2]);
  });

  it('restores the step and the running timers after a reload', () => {
    const session = newSession('r-1', steps, t0);
    session.stepIndex = 2;
    session.timers[1] = startTimer(session.timers[1]!, t0);
    saveSession(session, t0);

    const restored = loadSession('r-1', t0 + 60_000);

    expect(restored?.stepIndex).toBe(2);
    // The absolute end time is what makes the timer survive the reload.
    expect(remainingSeconds(restored!.timers[1]!, t0 + 60_000)).toBe(840);
  });

  it('refuses another recipe’s session', () => {
    saveSession(newSession('r-1', steps, t0), t0);
    expect(loadSession('r-2', t0)).toBeNull();
  });

  it('refuses a session left over from yesterday', () => {
    saveSession(newSession('r-1', steps, t0), t0);
    expect(loadSession('r-1', t0 + 13 * 60 * 60 * 1000)).toBeNull();
  });

  it('survives corrupt storage without throwing', () => {
    localStorage.setItem('homecook:cookSession', 'not json');
    expect(loadSession('r-1', t0)).toBeNull();
  });
});

describe('clampStep', () => {
  it('keeps an index inside the recipe', () => {
    // A recipe edited mid-cook can lose steps.
    expect(clampStep(9, 3)).toBe(2);
    expect(clampStep(-1, 3)).toBe(0);
    expect(clampStep(1, 3)).toBe(1);
  });

  it('handles a recipe with no steps', () => {
    expect(clampStep(4, 0)).toBe(0);
  });
});
