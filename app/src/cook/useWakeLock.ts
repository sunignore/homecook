import { useEffect, useState } from 'react';

// Keeps the screen on while cooking (docs/design.md E4). Best-effort: the API
// is unavailable on some browsers and the lock is dropped whenever the page is
// hidden, so it has to be re-acquired on return rather than requested once.

export function useWakeLock(active: boolean): { held: boolean; supported: boolean } {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!active || !supported) {
      setHeld(false);
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void sentinel.release();
          return;
        }
        setHeld(true);
        // The browser releases the lock when the tab is hidden; this fires then.
        sentinel.addEventListener('release', () => setHeld(false));
      } catch {
        // Denied (low battery, policy) — cooking continues, the screen just sleeps.
        setHeld(false);
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') void acquire();
    }

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => {});
      setHeld(false);
    };
  }, [active, supported]);

  return { held, supported };
}
