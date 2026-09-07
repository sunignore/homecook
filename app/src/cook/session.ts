// The cook session — which recipe, which step, which timers.
//
// Persisted outside React so the screen sleeping, the tab being backgrounded or
// the page reloading all return to the same step with the timers still counting
// (docs/design.md E4: never lose the user's place). localStorage rather than
// IndexedDB because this is per-device, transient, and must be readable
// synchronously on first paint — a session restored one frame late would show
// step 1 and then jump.

import type { CookTimer } from './timers';
import { createTimer } from './timers';
import type { RecipeStep } from '../db/types';

const KEY = 'homecook:cookSession';

/** Sessions older than this are stale, not resumable. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface CookSession {
  recipeId: string;
  stepIndex: number;
  timers: CookTimer[];
  startedAt: number;
  updatedAt: number;
}

export function newSession(recipeId: string, steps: readonly RecipeStep[], now = Date.now()): CookSession {
  return {
    recipeId,
    stepIndex: 0,
    // One timer per step that has a duration — parsed at import, so they are
    // ready before cook mode is ever opened (docs/data-model.md §2).
    timers: steps.flatMap((step, index) =>
      step.durationSec === undefined
        ? []
        : [createTimer(index, step.text.slice(0, 40), step.durationSec)],
    ),
    startedAt: now,
    updatedAt: now,
  };
}

function isSession(value: unknown): value is CookSession {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.recipeId === 'string' &&
    typeof s.stepIndex === 'number' &&
    Array.isArray(s.timers) &&
    typeof s.startedAt === 'number'
  );
}

/**
 * Read the stored session for a recipe.
 *
 * Returns null for another recipe's session, a stale one, or unreadable
 * storage — resuming into the wrong recipe would be worse than starting over.
 */
export function loadSession(recipeId: string, now = Date.now()): CookSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isSession(parsed)) return null;
    if (parsed.recipeId !== recipeId) return null;
    if (now - parsed.startedAt > MAX_AGE_MS) return null;

    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: CookSession, now = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...session, updatedAt: now }));
  } catch {
    // Private mode or blocked storage — cooking still works, it just will not
    // survive a reload.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do; the stale entry expires on its own.
  }
}

/** Step index clamped into range — a recipe edited mid-cook can shrink. */
export function clampStep(index: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  return Math.min(Math.max(index, 0), stepCount - 1);
}
