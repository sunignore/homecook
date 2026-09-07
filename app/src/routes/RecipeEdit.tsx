import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import RecipeDraftForm, { type DraftStep } from '../components/RecipeDraftForm';
import { updateRecipe, type DraftIngredient } from '../import/importRecipe';
import { replaceRecipePhoto } from '../photos/photoStore';

// Editing reuses the import correction form: both are the same job, and the
// ingredient rows must go through the same resolution so a rename here can land
// on an existing ingredient rather than forking the vocabulary (ADR-0002).

export default function RecipeEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const loaded = useLiveQuery(async () => {
    if (!id) return null;
    const recipe = await db.recipes.get(id);
    if (!recipe) return null;

    // Ingredients are stored as references, so the editable rows need names.
    const rows = await db.ingredients.bulkGet(recipe.ingredients.map(i => i.ingredientId));

    const draftRows: DraftIngredient[] = recipe.ingredients.map((ri, index) => ({
      name: rows[index]?.name ?? '',
      qty: ri.qty,
      unit: ri.unit,
      note: ri.note,
      optional: ri.optional,
      // Carried through so an unchanged row keeps pointing at the same
      // ingredient even if another one now shares its name.
      ingredientId: ri.ingredientId,
    }));

    const steps: DraftStep[] = recipe.steps.map((s, idx) => ({ ...s, key: `s${idx}` }));
    const photo = recipe.photoId ? ((await db.photos.get(recipe.photoId))?.blob ?? null) : null;

    return { recipe, draftRows, steps, photo };
  }, [id]);

  if (loaded === undefined) return <p className="muted">불러오는 중…</p>;
  if (loaded === null) {
    return (
      <div className="stack">
        <p className="muted">레시피를 찾을 수 없습니다.</p>
        <button type="button" className="btn-quiet" onClick={() => navigate('/recipes')}>
          목록으로
        </button>
      </div>
    );
  }

  const { recipe, draftRows, steps, photo } = loaded;

  return (
    <div className="stack">
      <h1>레시피 편집</h1>
      <RecipeDraftForm
        initialTitle={recipe.title}
        initialServings={recipe.servings}
        initialRows={draftRows}
        initialSteps={steps}
        initialTags={recipe.tags}
        initialPhoto={photo}
        submitLabel="저장"
        secondaryLabel="취소"
        onSecondary={() => navigate(`/recipes/${recipe.id}`)}
        onSubmit={async (draft, nextPhoto) => {
          await updateRecipe(recipe.id, draft);
          // undefined means the photo was not touched; null clears it.
          if (nextPhoto !== undefined) await replaceRecipePhoto(recipe.id, nextPhoto);
          navigate(`/recipes/${recipe.id}`);
        }}
      />
    </div>
  );
}
