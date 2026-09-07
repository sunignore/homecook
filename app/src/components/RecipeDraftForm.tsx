import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertCircle, Check, Plus, Trash2 } from 'lucide-react';
import { db } from '../db/db';
import { resolveIngredients } from '../import/resolveIngredients';
import type { DraftIngredient, RecipeDraft } from '../import/importRecipe';
import type { RecipeStep } from '../db/types';
import './RecipeDraftForm.css';

// Shared by the import correction step and by editing a saved recipe: both are
// the same job — get the ingredient rows right before they are written — and a
// second copy of this form would drift from the first.

export interface DraftStep extends RecipeStep {
  key: string;
}

export interface RecipeDraftFormProps {
  initialTitle: string;
  initialServings: number;
  initialRows: DraftIngredient[];
  initialSteps: DraftStep[];
  /** Lines the parser could not classify; omitted when editing. */
  unparsed?: string[];
  submitLabel: string;
  onSubmit: (draft: Omit<RecipeDraft, 'sourceText' | 'tags'>) => Promise<void>;
  secondaryLabel: string;
  onSecondary: () => void;
}

export default function RecipeDraftForm({
  initialTitle,
  initialServings,
  initialRows,
  initialSteps,
  unparsed = [],
  submitLabel,
  onSubmit,
  secondaryLabel,
  onSecondary,
}: RecipeDraftFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [servings, setServings] = useState(initialServings);
  const [rows, setRows] = useState<DraftIngredient[]>(initialRows);
  const [steps, setSteps] = useState<DraftStep[]>(initialSteps);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = useLiveQuery(() => db.ingredients.toArray(), [], []);

  // Recomputed on every edit, so renaming a row onto an existing ingredient
  // clears its "new" flag immediately rather than at save time.
  const newFlags = useMemo(() => {
    const resolutions = resolveIngredients(
      rows.map(r => ({
        name: r.name,
        qty: r.qty,
        unit: r.unit,
        optional: r.optional,
        raw: r.name,
      })),
      existing,
    );
    return resolutions.map(r => !r.match);
  }, [rows, existing]);

  const newCount = newFlags.filter(Boolean).length;

  function updateRow(index: number, patch: Partial<DraftIngredient>) {
    setRows(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        title,
        servings,
        ingredients: rows,
        steps: steps.map(({ key: _key, ...s }) => s),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.');
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      {/* Status is colour + icon + text, never colour alone — kitchen glare
          washes out hue (docs/design.md §6, E3). */}
      {newCount > 0 && (
        <p className="banner banner-new">
          <Plus size={20} strokeWidth={2} aria-hidden="true" />
          <span>
            새로 만들어질 재료 <strong>{newCount}개</strong>. 이미 있는 재료라면 이름을 맞춰
            주세요 — 그래야 나중에 냉장고·장보기가 제대로 묶입니다.
          </span>
        </p>
      )}

      <label className="field">
        <span className="field-label">제목</span>
        <input value={title} onChange={e => setTitle(e.target.value)} />
      </label>

      <label className="field field-narrow">
        <span className="field-label">인분</span>
        <input
          type="number"
          min={1}
          value={servings}
          onChange={e => setServings(Number(e.target.value))}
        />
      </label>

      <section className="stack" aria-labelledby="ing-heading">
        <h2 id="ing-heading">재료 ({rows.length})</h2>

        <ul className="row-list">
          {rows.map((row, index) => (
            <li key={index} className="ing-row">
              <div className="ing-main">
                <input
                  className="ing-name"
                  value={row.name}
                  onChange={e => updateRow(index, { name: e.target.value })}
                  aria-label={`재료 ${index + 1} 이름`}
                />
                <input
                  className="ing-qty numeric"
                  value={row.qty ?? ''}
                  onChange={e =>
                    updateRow(index, { qty: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  placeholder="양"
                  aria-label={`재료 ${index + 1} 수량`}
                />
                <input
                  className="ing-unit"
                  value={row.unit}
                  onChange={e => updateRow(index, { unit: e.target.value })}
                  placeholder="단위"
                  aria-label={`재료 ${index + 1} 단위`}
                />
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => setRows(prev => prev.filter((_, i) => i !== index))}
                  aria-label={`재료 ${index + 1} 삭제`}
                >
                  <Trash2 size={20} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>

              <div className="ing-meta">
                {newFlags[index] ? (
                  <span className="tag tag-new">
                    <Plus size={16} strokeWidth={2.5} aria-hidden="true" />새 재료
                  </span>
                ) : (
                  <span className="tag tag-known">
                    <Check size={16} strokeWidth={2.5} aria-hidden="true" />기존 재료
                  </span>
                )}
                <label className="optional-toggle">
                  <input
                    type="checkbox"
                    checked={row.optional}
                    onChange={e => updateRow(index, { optional: e.target.checked })}
                  />
                  선택 재료
                </label>
                {row.note && <span className="muted note">{row.note}</span>}
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn-quiet"
          onClick={() => setRows(prev => [...prev, { name: '', qty: null, unit: '', optional: false }])}
        >
          <Plus size={20} strokeWidth={2} aria-hidden="true" /> 재료 추가
        </button>
      </section>

      <section className="stack" aria-labelledby="step-heading">
        <h2 id="step-heading">조리 단계 ({steps.length})</h2>
        <ol className="row-list">
          {steps.map((step, index) => (
            <li key={step.key} className="step-row">
              <textarea
                value={step.text}
                rows={2}
                onChange={e =>
                  setSteps(prev =>
                    prev.map((s, i) => (i === index ? { ...s, text: e.target.value } : s)),
                  )
                }
                aria-label={`${index + 1}단계`}
              />
              <div className="ing-meta">
                {step.durationSec !== undefined && (
                  <span className="tag tag-timer numeric">
                    타이머 {Math.round(step.durationSec / 60)}분
                  </span>
                )}
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => setSteps(prev => prev.filter((_, i) => i !== index))}
                  aria-label={`${index + 1}단계 삭제`}
                >
                  <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="btn-quiet"
          onClick={() =>
            setSteps(prev => [...prev, { key: `s${Date.now()}`, text: '' }])
          }
        >
          <Plus size={20} strokeWidth={2} aria-hidden="true" /> 단계 추가
        </button>
      </section>

      {unparsed.length > 0 && (
        <section className="stack" aria-labelledby="unparsed-heading">
          <h2 id="unparsed-heading">분류하지 못한 줄 ({unparsed.length})</h2>
          <p className="muted">
            버리지 않고 보여드립니다. 재료나 단계였다면 위에 직접 추가해 주세요.
          </p>
          <ul className="unparsed-list">
            {unparsed.map((line, i) => (
              <li key={i} className="muted">
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p className="banner banner-error" role="alert">
          <AlertCircle size={20} strokeWidth={2} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      <div className="actions actions-sticky">
        <button
          type="button"
          className="btn-primary"
          onClick={handleSubmit}
          disabled={saving || title.trim().length === 0}
        >
          {saving ? '저장 중…' : submitLabel}
        </button>
        <button type="button" className="btn-quiet" onClick={onSecondary}>
          {secondaryLabel}
        </button>
      </div>
    </div>
  );
}
