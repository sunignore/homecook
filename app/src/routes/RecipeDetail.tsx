import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Timer, Trash2 } from 'lucide-react';
import { db } from '../db/db';
import './Recipes.css';

function formatQty(qty: number | null, unit: string): string {
  if (qty === null) return unit || '적당히';
  // 0.5 reads better as ½ at a glance across a counter (docs/design.md E1).
  const pretty = qty === 0.5 ? '½' : qty === 0.25 ? '¼' : qty === 0.75 ? '¾' : String(qty);
  return `${pretty}${unit}`;
}

export default function RecipeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const recipe = useLiveQuery(() => (id ? db.recipes.get(id) : undefined), [id]);
  // Ingredients are stored as references (ADR-0002), so names are resolved here.
  const names = useLiveQuery(async () => {
    if (!recipe) return new Map<string, string>();
    const rows = await db.ingredients.bulkGet(recipe.ingredientIds);
    return new Map(rows.filter(Boolean).map(r => [r!.id, r!.name]));
  }, [recipe]);

  async function handleDelete() {
    if (!recipe) return;
    // There is no server copy (ADR-0001), so deletion is permanent.
    if (!confirm(`"${recipe.title}"을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await db.recipes.delete(recipe.id);
    navigate('/recipes');
  }

  if (recipe === undefined) return <p className="muted">불러오는 중…</p>;
  if (recipe === null || !recipe) {
    return (
      <div className="stack">
        <p className="muted">레시피를 찾을 수 없습니다.</p>
        <Link to="/recipes" className="btn-quiet btn-link">
          목록으로
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <Link to="/recipes" className="back-link">
        <ArrowLeft size={20} strokeWidth={2} aria-hidden="true" />
        레시피
      </Link>

      <div className="page-head">
        <h1>{recipe.title}</h1>
        <button type="button" className="btn-icon" onClick={handleDelete} aria-label="레시피 삭제">
          <Trash2 size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <p className="muted numeric">{recipe.servings}인분</p>

      <section className="stack" aria-labelledby="detail-ing">
        <h2 id="detail-ing">재료</h2>
        <ul className="detail-list">
          {recipe.ingredients.map((ri, i) => (
            <li key={`${ri.ingredientId}-${i}`} className="detail-ing">
              <span>
                {names?.get(ri.ingredientId) ?? '알 수 없는 재료'}
                {ri.note && <span className="muted note"> · {ri.note}</span>}
              </span>
              <span className="numeric">{formatQty(ri.qty, ri.unit)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="stack" aria-labelledby="detail-steps">
        <h2 id="detail-steps">만드는 법</h2>
        <ol className="detail-list detail-steps">
          {recipe.steps.map((step, i) => (
            <li key={i}>
              <span>{step.text}</span>
              {step.durationSec !== undefined && (
                <span className="tag tag-timer numeric">
                  <Timer size={16} strokeWidth={2.5} aria-hidden="true" />
                  {Math.round(step.durationSec / 60)}분
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* Cook mode arrives in M2 (docs/product-brief.md §3); the step durations
          above are already the timers it will use. */}
      <p className="muted">조리 모드는 M2에서 추가됩니다.</p>
    </div>
  );
}
