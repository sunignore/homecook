import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertCircle, Check, Plus, Trash2 } from 'lucide-react';
import { db } from '../db/db';
import { parseRecipeText } from '../import/parseRecipeText';
import { resolveIngredients } from '../import/resolveIngredients';
import { importRecipe, type DraftIngredient } from '../import/importRecipe';
import type { RecipeStep } from '../db/types';
import './RecipeImport.css';

// The correction step, not the parse step, is what makes importing beat typing:
// the parser only has to be ~80% right if fixing the rest is fast
// (docs/product-brief.md §4 Risk A).

type Phase = 'paste' | 'correct';

interface DraftStep extends RecipeStep {
  key: string;
}

export default function RecipeImport() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('paste');
  const [sourceText, setSourceText] = useState('');
  const [title, setTitle] = useState('');
  const [servings, setServings] = useState(2);
  const [rows, setRows] = useState<DraftIngredient[]>([]);
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unparsed, setUnparsed] = useState<string[]>([]);

  const existing = useLiveQuery(() => db.ingredients.toArray(), [], []);

  // Which rows would create a brand new ingredient. Recomputed on every edit so
  // renaming a row to an existing ingredient immediately clears its "new" flag.
  const newFlags = useMemo(() => {
    const resolutions = resolveIngredients(
      rows.map(r => ({ name: r.name, qty: r.qty, unit: r.unit, raw: r.name, optional: r.optional })),
      existing,
    );
    return resolutions.map(r => !r.match);
  }, [rows, existing]);

  const newCount = newFlags.filter(Boolean).length;

  function handleParse() {
    const parsed = parseRecipeText(sourceText);
    setTitle(parsed.title ?? '');
    setServings(parsed.servings ?? 2);
    setRows(
      parsed.ingredients.map(i => ({
        name: i.name,
        qty: i.qty,
        unit: i.unit,
        note: i.note,
        optional: i.optional,
      })),
    );
    setSteps(parsed.steps.map((s, idx) => ({ ...s, key: `s${idx}` })));
    setUnparsed(parsed.unparsed);
    setPhase('correct');
  }

  function updateRow(index: number, patch: Partial<DraftIngredient>) {
    setRows(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    setRows(prev => [...prev, { name: '', qty: null, unit: '', optional: false }]);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const id = await importRecipe({
        title,
        servings,
        tags: [],
        sourceText,
        ingredients: rows,
        steps: steps.map(({ key: _key, ...s }) => s),
      });
      navigate(`/recipes/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.');
      setSaving(false);
    }
  }

  if (phase === 'paste') {
    return (
      <div className="stack">
        <h1>레시피 가져오기</h1>
        <p className="muted">
          블로그나 영상 설명란의 레시피를 통째로 붙여넣으세요. 재료와 조리 단계를 분리해
          초안을 만들어 드립니다. 다음 화면에서 고칠 수 있습니다.
        </p>

        <label className="field">
          <span className="field-label">레시피 원문</span>
          <textarea
            className="paste-area"
            value={sourceText}
            onChange={e => setSourceText(e.target.value)}
            rows={14}
            placeholder={'김치찌개\n\n재료\n- 신김치 300g\n- 두부 1/2모\n\n만드는 법\n1. 5분간 볶는다.'}
          />
        </label>

        <div className="actions">
          <button
            type="button"
            className="btn-primary"
            onClick={handleParse}
            disabled={sourceText.trim().length === 0}
          >
            분석하기
          </button>
          <button type="button" className="btn-quiet" onClick={() => navigate('/recipes')}>
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>확인하고 고치기</h1>

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
                    updateRow(index, {
                      qty: e.target.value === '' ? null : Number(e.target.value),
                    })
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
                  onClick={() => removeRow(index)}
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
                {row.note && <span className="muted note">{row.note}</span>}
              </div>
            </li>
          ))}
        </ul>

        <button type="button" className="btn-quiet" onClick={addRow}>
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
              {step.durationSec !== undefined && (
                <span className="tag tag-timer numeric">
                  타이머 {Math.round(step.durationSec / 60)}분
                </span>
              )}
            </li>
          ))}
        </ol>
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
          onClick={handleSave}
          disabled={saving || title.trim().length === 0}
        >
          {saving ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="btn-quiet" onClick={() => setPhase('paste')}>
          원문 고치기
        </button>
      </div>
    </div>
  );
}
