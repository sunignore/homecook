import { z } from 'zod';
import { cloudSessionClient } from '../household/cloudAuth';
import {
  cloudPhotoBeginResultSchema,
  cloudPhotoFinalizeResultSchema,
  cloudPhotoSchema,
  cloudRecipeSaveInputSchema,
  cloudRecipeSnapshotSchema,
  cloudVersionResultSchema,
  type CloudPhoto,
  type CloudRecipeSaveInput,
  type CloudRecipeSnapshot,
} from './recipeContracts';

const uuid = z.string().uuid();
const supportedPhotoType = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PHOTO_BYTES = 5_242_880;

async function authenticatedClient() {
  const selected = await cloudSessionClient();
  if (!selected) throw new Error('로그인이 필요합니다.');
  return selected;
}

function rpcData<T>(error: { message: string } | null, data: unknown, schema: z.ZodType<T>): T {
  if (error) throw new Error(error.message);
  return schema.parse(data);
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function fetchCloudRecipes(): Promise<CloudRecipeSnapshot> {
  const selected = await authenticatedClient();
  const result = await selected.rpc('cloud_recipe_snapshot');
  return rpcData(result.error, result.data, cloudRecipeSnapshotSchema);
}

export async function saveCloudRecipe(
  input: CloudRecipeSaveInput,
  expectedVersion: number | null,
  commandId: string = crypto.randomUUID(),
) {
  const recipe = cloudRecipeSaveInputSchema.parse(input);
  uuid.parse(commandId);
  z.number().int().positive().nullable().parse(expectedVersion);
  const selected = await authenticatedClient();
  const result = await selected.rpc('cloud_recipe_save', {
    command_id: commandId,
    expected_version: expectedVersion,
    recipe,
  });
  return rpcData(result.error, result.data, cloudVersionResultSchema);
}

export async function deleteCloudRecipe(
  recipeId: string,
  expectedVersion: number,
  commandId: string = crypto.randomUUID(),
) {
  uuid.parse(recipeId);
  uuid.parse(commandId);
  z.number().int().positive().parse(expectedVersion);
  const selected = await authenticatedClient();
  const result = await selected.rpc('cloud_recipe_delete', {
    command_id: commandId,
    recipe_id: recipeId,
    expected_version: expectedVersion,
  });
  return rpcData(result.error, result.data, cloudVersionResultSchema);
}

export async function uploadCloudPhoto(
  blob: Blob,
  commandIds: { begin: string; finalize: string; abort: string } = {
    begin: crypto.randomUUID(),
    finalize: crypto.randomUUID(),
    abort: crypto.randomUUID(),
  },
): Promise<CloudPhoto['id']> {
  for (const value of Object.values(commandIds)) uuid.parse(value);
  const mimeType = supportedPhotoType.parse(blob.type);
  if (blob.size < 1 || blob.size > MAX_PHOTO_BYTES) throw new Error('사진은 5MB 이하여야 합니다.');

  const selected = await authenticatedClient();
  const proposedId = commandIds.begin;
  const begun = await selected.rpc('cloud_photo_begin', {
    command_id: commandIds.begin,
    metadata: {
      id: proposedId,
      sha256: await sha256(blob),
      mimeType,
      byteSize: blob.size,
    },
  });
  const upload = rpcData(begun.error, begun.data, cloudPhotoBeginResultSchema);
  if (!upload.uploadRequired) return upload.id;

  const bucket = selected.storage.from('cloud-photos');
  const uploaded = await bucket.upload(upload.objectPath, blob, {
    contentType: mimeType,
    upsert: false,
  });
  const finalize = async () => {
    const finalized = await selected.rpc('cloud_photo_finalize', {
      command_id: commandIds.finalize,
      photo_id: upload.id,
    });
    return rpcData(finalized.error, finalized.data, cloudPhotoFinalizeResultSchema);
  };

  try {
    // An upload error can mean a previous attempt already wrote this object.
    if (uploaded.error) return (await finalize()).id;
    return (await finalize()).id;
  } catch (error) {
    await bucket.remove([upload.objectPath]);
    await selected.rpc('cloud_photo_abort', {
      command_id: commandIds.abort,
      photo_id: upload.id,
    });
    throw error;
  }
}

export async function downloadCloudPhoto(photo: CloudPhoto): Promise<Blob> {
  const expected = cloudPhotoSchema.parse(photo);
  const selected = await authenticatedClient();
  const downloaded = await selected.storage.from('cloud-photos').download(expected.objectPath);
  if (downloaded.error || !downloaded.data) {
    throw new Error(downloaded.error?.message ?? '사진을 내려받지 못했습니다.');
  }
  const blob = downloaded.data;
  if (
    blob.size !== expected.byteSize
    || blob.type !== expected.mimeType
    || await sha256(blob) !== expected.sha256
  ) {
    throw new Error('다운로드한 사진이 서버 메타데이터와 일치하지 않습니다.');
  }
  return blob;
}