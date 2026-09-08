// Photo payload representation.
//
// Photos are stored as raw bytes, not as Blob objects. Chromium writes an IDB
// Blob through a separate file-backed path that can fail independently of the
// record write — the origin surfaces it as
// "UnknownError: Error preparing Blob/File data to be stored in object store",
// which blocked saving a recipe and restoring a backup while the rest of the
// database was healthy. An ArrayBuffer travels the ordinary structured-clone
// path, so a photo now fails only when the record itself fails.
//
// Rows written before this change hold a `blob` instead; they are read through
// the same helpers rather than migrated, because a failed upgrade() would leave
// the database unopenable — and with no server copy (ADR-0001) that is the one
// failure the user cannot recover from.

import type { Photo, StoredPhoto } from '../db/types';

/** Fallback when a source blob carries no type, so reads never guess. */
const DEFAULT_TYPE = 'image/jpeg';

/** Build the stored record for an already-downscaled image. */
export async function toPhotoRecord(
  blob: Blob,
  id: string,
  createdAt: number = Date.now(),
): Promise<Photo> {
  return {
    id,
    bytes: await blob.arrayBuffer(),
    type: blob.type || DEFAULT_TYPE,
    createdAt,
  };
}

/** Rebuild a displayable Blob from either row shape. */
export function photoBlob(stored: StoredPhoto | undefined | null): Blob | null {
  if (!stored) return null;
  if ('bytes' in stored) return new Blob([stored.bytes], { type: stored.type });
  return stored.blob;
}

/** Raw bytes and MIME type, for writing a photo into a backup archive. */
export async function photoPayload(
  stored: StoredPhoto,
): Promise<{ bytes: Uint8Array; type: string }> {
  if ('bytes' in stored) {
    return { bytes: new Uint8Array(stored.bytes), type: stored.type || DEFAULT_TYPE };
  }
  return {
    bytes: new Uint8Array(await stored.blob.arrayBuffer()),
    type: stored.blob.type || DEFAULT_TYPE,
  };
}
