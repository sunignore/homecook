import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ChefHat, Pencil, Star, Timer, Trash2 } from 'lucide-react';
import { db } from '../db/db';
import { addCookLog, cookLogsFor, deleteCookLog, deleteRecipeWithLogs, summarize } from '../cooklog/cookLog';
import type { Rating } from '../db/types';
import './Recipes.css';

function formatQty(qty: number | null, unit: string): string {
  if (qty === null) return unit || '적당히';
  // Fractions read better as glyphs at counter distance (docs/design.md E1).
  const pretty = qty === 0.5 ? '½' : qty === 0.25 ? '¼' : qty === 0.75 ? '¾' : String(qty);
  return `${pretty}${unit}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

const RATINGS: Rating[] = [1, 2, 3, 4, 5];

export default function RecipeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [logging, setLogging] = useState(false);
  const [rating, setRating] = useState<Rating>(4);
  const [memo, setMemo] = useState('');
  const [tweaks, setTweaks] = useState('');
  const [saving, setSaving] = useState(false);

  const recipe = useLiveQuery(() => (id ? db.recipes.get(id) : undefined), [id]);
  const logs = useLiveQuery(() => (id ? cookLogsFor(id) : Promise.resolve([])), [id], []);
  const names = useLiveQuery(async () => {
    if (!recipe) return new Map<string, string>();
    const rows = await db.ingredients.bulkGet(recipe.ingredientIds);
    return new Map(rows.filter(Boolean).map(r => [r!.id, r!.name]));
  }, [recipe]);

  const summary = summarize(logs);

  async function handleDelete() {
    if (!recipe) return;
    // No server copy (ADR-0001) — deletion is permanent, and it takes the cook
    // logs with it, so the confirmation says so.
    const extra = logs.length > 0 ? `\n요리 기록 ${logs.length}건도 함께 지워집니다.` : '';
    if (!confirm(`"${recipe.title}"을(를) 삭제할까요? 되돌릴 수 없습니다.${extra}`)) return;
    await deleteRecipeWithLogs(recipe.id);
    navigate('/recipes');
  }

  async function handleLogSubmit() {
    if (!recipe) return;
    setSaving(true);
    try {
      await addCookLog({ recipeId: recipe.id, rating, memo, tweaks });
      setLogging(false);
      setMemo('');
      setTweaks('');
      setRating(4);
    } finally {
      setSaving(false);
    }
  }

  if (recipe === undefined) return <p className="muted">불러오는 중…</p>;
  if (!recipe) {
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
        <div className="head-actions">
          <Link
            to={`/recipes/${recipe.id}/edit`}
            className="btn-icon btn-link"
            aria-label="레시피 편집"
          >
            <Pencil size={20} strokeWidth={2} aria-hidden="true" />
          </Link>
          <button type="button" className="btn-icon" onClick={handleDelete} aria-label="레시피 삭제">
            <Trash2 size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="muted numeric">
        {recipe.servings}인분
        {summary.count > 0 && (
          <>
            {' · '}
            {summary.count}번 만듦 · 평균 {summary.averageRating}점 · 최근{' '}
            {formatDate(summary.lastCookedAt!)}
          </>
        )}
      </p>

      <section className="stack" aria-labelledby="detail-ing">
        <h2 id="detail-ing">재료</h2>
        <ul className="detail-list">
          {recipe.ingredients.map((ri, i) => (
            <li key={`${ri.ingredientId}-${i}`} className="detail-ing">
              <span>
                {names?.get(ri.ingredientId) ?? '알 수 없는 재료'}
                {ri.optional && <span className="tag tag-timer"> 선택</span>}
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
              {/* Wrapper keeps the <li> a list-item so its number renders —
                  flexing the <li> itself removes the marker. */}
              <div className="step-body">
                <span>{step.text}</span>
                {step.durationSec !== undefined && (
                  <span className="tag tag-timer numeric">
                    <Timer size={16} strokeWidth={2.5} aria-hidden="true" />
                    {Math.round(step.durationSec / 60)}분
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="stack" aria-labelledby="cook-log">
        <h2 id="cook-log">요리 기록</h2>

        {logging ? (
          <div className="card stack">
            <fieldset className="rating-field">
              <legend className="field-label">어땠나요?</legend>
              <div className="rating-row">
                {RATINGS.map(value => (
                  <button
                    key={value}
                    type="button"
                    className={value <= rating ? 'star star-on' : 'star'}
                    onClick={() => setRating(value)}
                    aria-label={`${value}점`}
                    aria-pressed={value === rating}
                  >
                    <Star
                      size={28}
                      strokeWidth={2}
                      fill={value <= rating ? 'currentColor' : 'none'}
                      aria-hidden="true"
                    />
                  </button>
                ))}
                {/* Rating is never conveyed by the stars alone (docs/design.md §6). */}
                <span className="numeric rating-value">{rating}점</span>
              </div>
            </fieldset>

            <label className="field">
              <span className="field-label">메모</span>
              <textarea rows={2} value={memo} onChange={e => setMemo(e.target.value)} />
            </label>

            <label className="field">
              <span className="field-label">다음엔 이렇게</span>
              <textarea
                rows={2}
                value={tweaks}
                onChange={e => setTweaks(e.target.value)}
                placeholder="설탕 반으로, 물 조금 더"
              />
            </label>

            <div className="actions">
              <button type="button" className="btn-primary" onClick={handleLogSubmit} disabled={saving}>
                {saving ? '저장 중…' : '기록 저장'}
              </button>
              <button type="button" className="btn-quiet" onClick={() => setLogging(false)}>
                취소
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn-primary cook-button" onClick={() => setLogging(true)}>
            <ChefHat size={20} strokeWidth={2} aria-hidden="true" />
            만들었어요
          </button>
        )}

        {logs.length === 0 ? (
          <p className="muted">아직 기록이 없습니다.</p>
        ) : (
          <ul className="detail-list">
            {logs.map(log => (
              <li key={log.id} className="log-row">
                <div className="log-head">
                  <span className="numeric">
                    {formatDate(log.cookedAt)} · {log.rating}점
                  </span>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => deleteCookLog(log.id)}
                    aria-label={`${formatDate(log.cookedAt)} 기록 삭제`}
                  >
                    <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
                {log.memo && <p className="log-note">{log.memo}</p>}
                {log.tweaks && (
                  <p className="log-tweak">
                    <strong>다음엔</strong> {log.tweaks}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Cook mode arrives in M2 (docs/product-brief.md §3); the step durations
          above are already the timers it will use. */}
      <p className="muted">조리 모드는 M2에서 추가됩니다.</p>
    </div>
  );
}
