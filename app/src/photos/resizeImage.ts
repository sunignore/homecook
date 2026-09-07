// Photo intake. Implements the sizing rule from docs/data-model.md §1.
//
// Phone cameras produce 3-6 MB files. Storing those unchanged would fill the
// origin's quota within a few dozen recipes, and eviction is permanent loss
// (ADR-0001) — so every photo is downscaled and re-encoded before it is stored.

/** Long edge, in pixels, of a stored photo (docs/data-model.md §1). */
export const MAX_EDGE = 1280;

export const JPEG_QUALITY = 0.82;

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Target size for an image, preserving aspect ratio.
 *
 * Never enlarges: a small photo is stored as-is rather than upscaled into a
 * bigger file with no more detail.
 */
export function fitWithin(source: Dimensions, maxEdge = MAX_EDGE): Dimensions {
  const longest = Math.max(source.width, source.height);
  if (longest <= maxEdge || longest === 0) {
    return { width: source.width, height: source.height };
  }

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

export class ImageDecodeError extends Error {
  constructor() {
    super('이미지를 읽을 수 없습니다.');
    this.name = 'ImageDecodeError';
  }
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      throw new ImageDecodeError();
    }
  }

  // Safari fallback for formats createImageBitmap declines.
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new ImageDecodeError());
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Decode, downscale and re-encode a picked image.
 *
 * Always re-encodes to JPEG: HEIC from an iPhone would otherwise be stored in a
 * format most browsers cannot display, so the photo would survive backup and
 * restore and still show nothing.
 */
export async function preparePhoto(file: Blob, maxEdge = MAX_EDGE): Promise<Blob> {
  const source = await decode(file);
  const size = fitWithin({ width: source.width, height: source.height }, maxEdge);

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageDecodeError();
  ctx.drawImage(source, 0, 0, size.width, size.height);

  if ('close' in source) source.close();

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new ImageDecodeError();

  return blob;
}
