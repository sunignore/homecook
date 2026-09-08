// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadCloudPhoto,
  fetchCloudRecipes,
  saveCloudRecipe,
  uploadCloudPhoto,
} from './recipeRepository';

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock('../household/cloudAuth', () => ({
  cloudSessionClient: vi.fn(async () => state.client),
}));

const home = '11111111-1111-4111-8111-111111111111';
const recipeId = '22222222-2222-4222-8222-222222222222';
const photoId = '33333333-3333-4333-8333-333333333333';
const commandIds = {
  begin: '44444444-4444-4444-8444-444444444444',
  finalize: '55555555-5555-4555-8555-555555555555',
  abort: '66666666-6666-4666-8666-666666666666',
};
const now = '2026-09-08T00:00:00.000Z';

function recipeInput() {
  return {
    id: recipeId,
    title: 'Soup',
    servings: 2,
    sourceUrl: null,
    sourceText: null,
    notes: '',
    tags: [],
    steps: [{text:'Boil',durationSec:null}],
    photoId: null,
    ingredients: [{
      ingredientId: null,
      name: 'Garlic',
      category: 'vegetable' as const,
      defaultUnit: 'g',
      isStaple: true,
      qty: 10,
      unit: 'g',
      note: '',
      optional: false,
    }],
  };
}

describe('cloud recipe repository', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let upload: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let download: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpc = vi.fn();
    upload = vi.fn();
    remove = vi.fn();
    download = vi.fn();
    state.client = {
      rpc,
      storage: { from: vi.fn(() => ({ upload, remove, download })) },
    } as unknown as SupabaseClient;
  });

  it('rejects malformed server snapshots instead of caching them', async () => {
    rpc.mockResolvedValue({
      error: null,
      data: { householdId: home, revision: 0, ingredients: [], photos: [], recipes: [], extra: true },
    });
    await expect(fetchCloudRecipes()).rejects.toThrow();
  });

  it('validates saves before issuing an exact idempotent RPC', async () => {
    rpc.mockResolvedValue({error:null,data:{id:recipeId,version:1}});
    const invalid = {...recipeInput(), title:''};
    await expect(saveCloudRecipe(invalid, null, commandIds.begin)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();

    await expect(saveCloudRecipe(recipeInput(), null, commandIds.begin)).resolves.toEqual({
      id:recipeId,version:1,
    });
    expect(rpc).toHaveBeenCalledWith('cloud_recipe_save', {
      command_id:commandIds.begin,
      expected_version:null,
      recipe:recipeInput(),
    });
  });

  it('uploads then finalizes a photo and cleans up a failed finalization', async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === 'cloud_photo_begin') {
        return {error:null,data:{id:photoId,objectPath:home+'/'+photoId,uploadRequired:true}};
      }
      if (name === 'cloud_photo_finalize') {
        return {error:null,data:{id:photoId,version:1,objectPath:home+'/'+photoId}};
      }
      return {error:null,data:{id:photoId,aborted:true}};
    });
    upload.mockResolvedValue({error:null});
    await expect(uploadCloudPhoto(new Blob(['photo'],{type:'image/jpeg'}),commandIds))
      .resolves.toBe(photoId);
    expect(rpc).toHaveBeenCalledWith('cloud_photo_begin',expect.objectContaining({
      command_id:commandIds.begin,metadata:expect.objectContaining({id:commandIds.begin}),
    }));
    expect(upload).toHaveBeenCalledWith(home+'/'+photoId,expect.any(Blob),{
      contentType:'image/jpeg',upsert:false,
    });

    rpc.mockImplementation(async (name: string) => {
      if (name === 'cloud_photo_begin') {
        return {error:null,data:{id:photoId,objectPath:home+'/'+photoId,uploadRequired:true}};
      }
      if (name === 'cloud_photo_finalize') return {error:{message:'metadata mismatch'},data:null};
      return {error:null,data:{id:photoId,aborted:true}};
    });
    remove.mockResolvedValue({error:null});
    await expect(uploadCloudPhoto(new Blob(['bad'],{type:'image/png'}),commandIds))
      .rejects.toThrow('metadata mismatch');
    expect(remove).toHaveBeenCalledWith([home+'/'+photoId]);
    expect(rpc).toHaveBeenLastCalledWith('cloud_photo_abort',{
      command_id:commandIds.abort,photo_id:photoId,
    });
  });

  it('verifies downloaded photo bytes against the strict metadata', async () => {
    const blob = new Blob(['photo'],{type:'image/jpeg'});
    const digest = await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest),value => value.toString(16).padStart(2,'0')).join('');
    download.mockResolvedValue({error:null,data:blob});
    const photo = {
      id:photoId,
      objectPath:home+'/'+photoId,
      sha256:hash,
      mimeType:'image/jpeg' as const,
      byteSize:blob.size,
      version:1,
      createdAt:now,
      updatedAt:now,
    };
    await expect(downloadCloudPhoto(photo)).resolves.toBe(blob);
    await expect(downloadCloudPhoto({...photo,sha256:'a'.repeat(64)}))
      .rejects.toThrow('서버 메타데이터와 일치하지 않습니다');
  });
});