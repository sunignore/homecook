// Backup envelope — the contract between an exported file and a future version
// of the app that has to read it.
//
// There is no server copy (ADR-0001), so this file is the ONLY thing standing
// between a browser eviction and permanent loss. It is therefore versioned
// explicitly and validated on the way in: a backup that cannot be read is worse
// than no backup, because the user believed they were covered.

import type { CookLog, Ingredient, Recipe } from '../db/types';

/** Identifies the file as ours, so an unrelated zip fails fast and clearly. */
export const BACKUP_FORMAT = 'homecook-backup';

/** Envelope version. Bump when the envelope shape changes, not the Dexie schema. */
export const BACKUP_VERSION = 1;

/** Dexie schema version the data was exported from (docs/data-model.md §3). */
export const CURRENT_SCHEMA_VERSION = 1;

export const MANIFEST_NAME = 'data.json';
export const PHOTO_DIR = 'photos';

export interface PhotoEntry {
  id: string;
  createdAt: number;
  /** Path inside the archive, e.g. "photos/<id>.jpg". */
  file: string;
  type: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  schemaVersion: number;
  exportedAt: number;
  /** Written for the restore confirmation screen — what the user is about to get. */
  counts: {
    recipes: number;
    ingredients: number;
    cookLogs: number;
    photos: number;
  };
  recipes: Recipe[];
  ingredients: Ingredient[];
  cookLogs: CookLog[];
  photos: PhotoEntry[];
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

export function photoExtension(type: string): string {
  return EXT_BY_TYPE[type] ?? 'bin';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed manifest before any destructive action.
 *
 * Restore replaces everything, so this runs BEFORE the existing data is
 * touched — a malformed file must never leave the archive half-erased.
 */
export function validateManifest(value: unknown): BackupManifest {
  if (!isObject(value)) {
    throw new BackupFormatError('백업 파일을 읽을 수 없습니다.');
  }

  if (value.format !== BACKUP_FORMAT) {
    throw new BackupFormatError('homecook 백업 파일이 아닙니다.');
  }

  if (typeof value.version !== 'number' || value.version > BACKUP_VERSION) {
    throw new BackupFormatError(
      '더 새로운 버전의 앱에서 만든 백업입니다. 앱을 업데이트한 뒤 다시 시도하세요.',
    );
  }

  if (typeof value.schemaVersion !== 'number' || value.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new BackupFormatError(
      '더 새로운 데이터 구조의 백업입니다. 앱을 업데이트한 뒤 다시 시도하세요.',
    );
  }

  for (const table of ['recipes', 'ingredients', 'cookLogs', 'photos'] as const) {
    if (!Array.isArray(value[table])) {
      throw new BackupFormatError(`백업이 손상되었습니다 — ${table} 항목이 없습니다.`);
    }
  }

  return value as unknown as BackupManifest;
}
