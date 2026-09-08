// Reading the last synced snapshot must not cost the Supabase client. Screens
// that only display shared state — Home, Plan, cook mode — import this module,
// and only code that actually talks to the server imports ./client.

import { db } from '../db/db';
import { snapshotSchema, type Snapshot } from './contracts';

// Which anonymous identity ./client last synced on this device. The snapshot is
// keyed by user id, and re-pairing leaves the previous row behind, so the active
// one has to be named rather than guessed.
const ACTIVE_USER = 'homecook:householdUser';

export function activeUser(): string | null {
  try {
    return localStorage.getItem(ACTIVE_USER);
  } catch {
    return null;
  }
}

export function setActiveUser(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_USER, id);
    else localStorage.removeItem(ACTIVE_USER);
  } catch {
    // Private mode: the cache read below simply reports an unpaired device.
  }
}

/** The last snapshot a sync stored, or null when this device is not paired. */
export async function cachedSnapshot(): Promise<Snapshot | null> {
  const user = activeUser();
  if (!user) return null;
  const row = await db.householdCache.get(user);
  return row ? snapshotSchema.parse(row.snapshot) : null;
}
