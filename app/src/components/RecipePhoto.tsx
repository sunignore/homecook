import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

// Photos are Blobs in IndexedDB (docs/data-model.md §2), so every render needs
// an object URL — and every one of them has to be revoked, or a scroll through
// the recipe list leaks a URL per card for the life of the session.

export default function RecipePhoto({
  photoId,
  alt,
  className,
}: {
  photoId: string | undefined;
  alt: string;
  className?: string;
}) {
  const blob = useLiveQuery(
    async () => (photoId ? ((await db.photos.get(photoId))?.blob ?? null) : null),
    [photoId],
  );
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (!url) return null;
  return <img className={className} src={url} alt={alt} loading="lazy" />;
}
