// Cook-mode timers.
//
// The central decision: a running timer stores its ABSOLUTE end time, never a
// remaining count. Decrementing a counter on an interval breaks in exactly the
// situation this feature exists for — the phone sleeps, the tab is backgrounded
// and throttled, or the page reloads — and a kitchen timer that quietly runs
// slow is worse than no timer at all.
//
// Everything here is a pure function of (state, now), so the behaviour is
// testable without faking clocks or waiting in real time.

export type TimerStatus = 'idle' | 'running' | 'paused' | 'done';

export interface CookTimer {
  id: string;
  /** Step this timer came from, so the UI can point back at it. */
  stepIndex: number;
  label: string;
  durationSec: number;
  /** Epoch ms the timer finishes at. Only meaningful while running. */
  endsAt: number | null;
  /** Seconds left while not running. */
  remainingSec: number;
  status: TimerStatus;
}

export function createTimer(
  stepIndex: number,
  label: string,
  durationSec: number,
  id: string = crypto.randomUUID(),
): CookTimer {
  return {
    id,
    stepIndex,
    label,
    durationSec,
    endsAt: null,
    remainingSec: durationSec,
    status: 'idle',
  };
}

/** Seconds left, floored at zero. Derived from the clock, never accumulated. */
export function remainingSeconds(timer: CookTimer, now: number): number {
  if (timer.status !== 'running' || timer.endsAt === null) {
    return Math.max(0, timer.remainingSec);
  }
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}

export function startTimer(timer: CookTimer, now: number): CookTimer {
  if (timer.status === 'running') return timer;

  const seconds = timer.status === 'done' ? timer.durationSec : Math.max(0, timer.remainingSec);
  if (seconds <= 0) return timer;

  return { ...timer, status: 'running', endsAt: now + seconds * 1000, remainingSec: seconds };
}

export function pauseTimer(timer: CookTimer, now: number): CookTimer {
  if (timer.status !== 'running') return timer;
  return {
    ...timer,
    status: 'paused',
    remainingSec: remainingSeconds(timer, now),
    endsAt: null,
  };
}

export function resetTimer(timer: CookTimer): CookTimer {
  return { ...timer, status: 'idle', endsAt: null, remainingSec: timer.durationSec };
}

/** Add a minute to a running or paused timer — the most common correction. */
export function extendTimer(timer: CookTimer, seconds: number, now: number): CookTimer {
  const base = remainingSeconds(timer, now) + seconds;
  if (base <= 0) return timer;

  return timer.status === 'running'
    ? { ...timer, endsAt: now + base * 1000, remainingSec: base, status: 'running' }
    : { ...timer, remainingSec: base, status: timer.status === 'done' ? 'paused' : timer.status };
}

/**
 * Advance every timer to `now`, marking any that have elapsed.
 *
 * Returns the timers whose status changed to 'done' on this pass so the caller
 * can sound the alarm exactly once. Because completion is derived from the
 * clock rather than from ticks, a timer that expired while the tab was asleep
 * is reported the moment the app wakes up instead of being missed.
 */
export function tickTimers(
  timers: readonly CookTimer[],
  now: number,
): { timers: CookTimer[]; justFinished: CookTimer[] } {
  const justFinished: CookTimer[] = [];

  const next = timers.map(timer => {
    if (timer.status !== 'running') return timer;
    if (remainingSeconds(timer, now) > 0) return timer;

    const finished: CookTimer = { ...timer, status: 'done', remainingSec: 0, endsAt: null };
    justFinished.push(finished);
    return finished;
  });

  return { timers: next, justFinished };
}

/** mm:ss, or h:mm:ss past an hour. Zero-padded so the width never jumps. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Fraction elapsed, 0-1 — drives the ring, never the readout. */
export function progress(timer: CookTimer, now: number): number {
  if (timer.durationSec <= 0) return 1;
  return 1 - remainingSeconds(timer, now) / timer.durationSec;
}

/** A spoken form for screen readers; the digits alone read badly aloud. */
export function announceRemaining(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0 && s > 0) return `${m}분 ${s}초 남음`;
  if (m > 0) return `${m}분 남음`;
  return `${s}초 남음`;
}
