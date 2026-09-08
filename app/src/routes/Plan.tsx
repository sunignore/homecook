import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertCircle, ChevronLeft, ChevronRight, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { db } from '../db/db';
import { getOrCreateIngredient } from '../ingredients/getOrCreateIngredient';
import { addDays, formatDayLabel, startOfWeek, todayLocalDateString, weekDates } from '../plan/date';
import { clearMealPlan, mealPlansForDates, setMealPlan } from '../plan/mealPlan';
import {
  addShoppingItem,
  clearChecked,
  deleteShoppingItem,
  generateShoppingList,
  sortShoppingItems,
  toggleShoppingItem,
} from '../plan/shoppingList';
import type { MealPlan, MealSlot } from '../db/types';
import './Plan.css';

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: '아침',
  lunch: '점심',
  dinner: '저녁',
};
const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

export default function Plan() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayLocalDateString()));
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [name, setName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const dates = useMemo(() => weekDates(weekStart), [weekStart]);

  const recipes = useLiveQuery(() => db.recipes.orderBy('title').toArray(), [], []);
  const plans = useLiveQuery(() => mealPlansForDates(dates), [dates], []);
  const ingredients = useLiveQuery(() => db.ingredients.toArray(), [], []);
  const shoppingItems = useLiveQuery(() => db.shoppingItems.toArray(), [], []);

  const ingredientsById = useMemo(() => new Map(ingredients.map(i => [i.id, i])), [ingredients]);
  const sortedShopping = useMemo(() => sortShoppingItems(shoppingItems), [shoppingItems]);
  const hasChecked = sortedShopping.some(i => i.checked);

  function entryFor(date: string, slot: MealSlot): MealPlan | undefined {
    return plans.find(p => p.date === date && p.slot === slot);
  }

  async function handleRecipeChange(date: string, slot: MealSlot, recipeId: string) {
    if (recipeId === '') await clearMealPlan(date, slot);
    else await setMealPlan({ date, slot, recipeId });
  }

  async function handleFreeTextCommit(date: string, slot: MealSlot, value: string) {
    const trimmed = value.trim();
    const entry = entryFor(date, slot);
    if (!trimmed) {
      if (entry && !entry.recipeId) await clearMealPlan(date, slot);
      return;
    }
    await setMealPlan({ date, slot, freeText: trimmed });
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateShoppingList(dates);
    } finally {
      setGenerating(false);
    }
  }

  async function handleAddItem() {
    if (!name.trim()) return;
    setAddError(null);
    try {
      const ingredient = await getOrCreateIngredient(name);
      await addShoppingItem({ ingredientId: ingredient.id, qty: Number(qty) || 1, unit: unit.trim() });
      setName('');
      setQty('');
      setUnit('');
    } catch (e) {
      setAddError(e instanceof Error ? e.message : '추가하지 못했습니다.');
    }
  }

  return (
    <div className="stack">
      <h1>계획</h1>

      <section className="stack" aria-labelledby="calendar-heading">
        <div className="page-head">
          <h2 id="calendar-heading">주간 식단</h2>
          <div className="week-nav">
            <button
              type="button"
              className="btn-icon"
              onClick={() => setWeekStart(prev => addDays(prev, -7))}
              aria-label="지난주"
            >
              <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className="muted numeric">
              {formatDayLabel(dates[0]!)} – {formatDayLabel(dates[6]!)}
            </span>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setWeekStart(prev => addDays(prev, 7))}
              aria-label="다음주"
            >
              <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>

        {dates.map(date => (
          <div className="card stack plan-day" key={date}>
            <h3 className="plan-day-heading">{formatDayLabel(date)}</h3>
            {SLOTS.map(slot => {
              const entry = entryFor(date, slot);
              return (
                <div className="plan-slot-row" key={slot}>
                  <span className="plan-slot-label muted">{SLOT_LABELS[slot]}</span>
                  <select
                    className="plan-slot-select"
                    value={entry?.recipeId ?? ''}
                    onChange={e => void handleRecipeChange(date, slot, e.target.value)}
                    aria-label={`${formatDayLabel(date)} ${SLOT_LABELS[slot]} 레시피`}
                  >
                    <option value="">—</option>
                    {recipes.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </select>
                  <input
                    key={`${date}-${slot}-${entry?.freeText ?? ''}-${entry?.recipeId ?? ''}`}
                    className="plan-slot-freetext"
                    defaultValue={entry?.recipeId ? '' : entry?.freeText ?? ''}
                    onBlur={e => void handleFreeTextCommit(date, slot, e.target.value)}
                    placeholder="외식, 남은 음식…"
                    disabled={Boolean(entry?.recipeId)}
                    aria-label={`${formatDayLabel(date)} ${SLOT_LABELS[slot]} 직접 입력`}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section className="card stack" aria-labelledby="shopping-heading">
        <div className="page-head">
          <h2 id="shopping-heading">
            <ShoppingCart size={20} strokeWidth={2} aria-hidden="true" /> 장보기 리스트
          </h2>
          <button type="button" className="btn-quiet" onClick={() => void handleGenerate()} disabled={generating}>
            {generating ? '만드는 중…' : '이번 주 계획으로 만들기'}
          </button>
        </div>

        <div className="pantry-add-row">
          <input
            className="pantry-add-name"
            list="shopping-ingredient-options"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="재료 이름"
            aria-label="재료 이름"
          />
          <datalist id="shopping-ingredient-options">
            {ingredients.map(i => (
              <option key={i.id} value={i.name} />
            ))}
          </datalist>
          <input
            className="pantry-add-qty numeric"
            value={qty}
            onChange={e => setQty(e.target.value)}
            placeholder="양"
            inputMode="decimal"
            aria-label="수량"
          />
          <input
            className="pantry-add-unit"
            value={unit}
            onChange={e => setUnit(e.target.value)}
            placeholder="단위"
            aria-label="단위"
          />
          <button type="button" className="btn-icon" onClick={() => void handleAddItem()} aria-label="장보기 항목 추가">
            <Plus size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {addError && (
          <p className="banner banner-error" role="alert">
            <AlertCircle size={20} strokeWidth={2} aria-hidden="true" />
            <span>{addError}</span>
          </p>
        )}

        {sortedShopping.length === 0 ? (
          <p className="muted">장보기 목록이 비어 있습니다.</p>
        ) : (
          <ul className="shopping-list">
            {sortedShopping.map(item => (
              <li key={item.id} className={item.checked ? 'shopping-row shopping-checked' : 'shopping-row'}>
                <label className="shopping-check">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={e => void toggleShoppingItem(item.id, e.target.checked)}
                  />
                  <span>
                    {ingredientsById.get(item.ingredientId)?.name ?? '알 수 없는 재료'}
                    <span className="muted numeric"> · {item.qty}{item.unit}</span>
                  </span>
                </label>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => void deleteShoppingItem(item.id)}
                  aria-label={`${ingredientsById.get(item.ingredientId)?.name ?? '항목'} 삭제`}
                >
                  <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {hasChecked && (
          <button type="button" className="btn-quiet" onClick={() => void clearChecked()}>
            산 항목 정리하기
          </button>
        )}
      </section>
    </div>
  );
}
