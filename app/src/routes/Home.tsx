import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ClipboardPaste, Refrigerator } from 'lucide-react';
import { db } from '../db/db';
import { isExpired, isExpiringSoon, sortByExpiry } from '../pantry/pantry';
import { oneIngredientAway, suggestRecipes } from '../pantry/suggestions';
import { todayLocalDateString } from '../plan/date';
import type { MealSlot } from '../db/types';
import './Home.css';
import { useHousehold } from '../household/useHousehold';

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: '아침',
  lunch: '점심',
  dinner: '저녁',
};
const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

// M1 stub graduated to the M3 suggestion surface (product-brief §5): "what can
// I cook now", the "one ingredient away" list, what's expiring soon, and
// today's plan once M4 has one to show.
export default function Home() {
  const { snapshot } = useHousehold();
  const recipes = useLiveQuery(() => db.recipes.toArray(), [], []);
  const ingredients = useLiveQuery(() => db.ingredients.toArray(), [], []);
  const pantryItems = useLiveQuery(() => db.pantryItems.toArray(), [], []);
  const cookLogs = useLiveQuery(() => db.cookLogs.toArray(), [], []);
  const today = useMemo(() => todayLocalDateString(), []);
  const todaysPlan = useLiveQuery(
    () => db.mealPlans.where('date').equals(today).toArray(),
    [today],
    [],
  );

  const ingredientsById = useMemo(() => new Map(ingredients.map(i => [i.id, i])), [ingredients]);
  const recipesById = useMemo(() => new Map(recipes.map(r => [r.id, r])), [recipes]);

  const suggestions = useMemo(
    () => suggestRecipes(recipes, ingredients, pantryItems, cookLogs),
    [recipes, ingredients, pantryItems, cookLogs],
  );
  const readyNow = suggestions.filter(s => s.score === 1);
  const almost = oneIngredientAway(suggestions).filter(s => s.score < 1);

  const now = Date.now();
  const expiringSoon = sortByExpiry(pantryItems.filter(p => isExpiringSoon(p, now) || isExpired(p, now)));

  const hasRecipes = recipes.length > 0;
  const hasPantry = pantryItems.length > 0;

  return (
    <div className="stack">
      <h1>오늘 뭐 먹지</h1>
      <Link to="/restaurant" className="card">우리집 식당 · 메뉴판과 주문함 →</Link>
      {snapshot && <p>{snapshot.name} · 접수 대기 {snapshot.orders.filter(o => o.status === 'pending').length}건</p>}

      {!hasRecipes ? (
        <div className="card stack empty">
          <h2>아직 레시피가 없습니다</h2>
          <p className="muted">
            레시피를 먼저 등록하면 지금 있는 재료로 무엇을 만들 수 있는지 알려드립니다.
          </p>
          <Link to="/recipes/import" className="btn-primary btn-link">
            <ClipboardPaste size={20} strokeWidth={2} aria-hidden="true" />
            레시피 붙여넣기
          </Link>
        </div>
      ) : !hasPantry ? (
        <div className="card stack empty">
          <h2>냉장고가 비어 있습니다</h2>
          <p className="muted">냉장고에 있는 재료를 등록하면 지금 만들 수 있는 요리를 추천해 드립니다.</p>
          <Link to="/pantry" className="btn-primary btn-link">
            <Refrigerator size={20} strokeWidth={2} aria-hidden="true" />
            냉장고로 가기
          </Link>
        </div>
      ) : (
        <>
          <section className="stack" aria-labelledby="ready-now">
            <h2 id="ready-now">지금 만들 수 있어요</h2>
            {readyNow.length === 0 ? (
              <p className="muted">지금 재료만으로 완성할 수 있는 레시피가 없습니다.</p>
            ) : (
              <ul className="suggestion-list">
                {readyNow.map(s => (
                  <li key={s.recipe.id}>
                    <Link to={`/recipes/${s.recipe.id}`} className="suggestion-card">
                      <span className="suggestion-title">{s.recipe.title}</span>
                      <span className="muted numeric">{s.recipe.servings}인분</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {almost.length > 0 && (
            <section className="stack" aria-labelledby="one-away">
              <h2 id="one-away">재료 하나만 있으면</h2>
              <ul className="suggestion-list">
                {almost.map(s => (
                  <li key={s.recipe.id}>
                    <Link to={`/recipes/${s.recipe.id}`} className="suggestion-row">
                      <span>{s.recipe.title}</span>
                      <span className="muted">
                        {ingredientsById.get(s.missing[0]!)?.name ?? '재료'} 없음
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {expiringSoon.length > 0 && (
        <section className="card stack" aria-labelledby="expiring-heading">
          <h2 id="expiring-heading">
            <AlertTriangle size={20} strokeWidth={2} aria-hidden="true" /> 유통기한 임박
          </h2>
          <ul className="expiring-list">
            {expiringSoon.slice(0, 5).map(item => (
              <li key={item.id} className="expiring-row">
                <span>{ingredientsById.get(item.ingredientId)?.name ?? '알 수 없는 재료'}</span>
                <span className={isExpired(item, now) ? 'tag tag-expired' : 'tag tag-soon'}>
                  {isExpired(item, now) ? '지남' : '임박'}
                </span>
              </li>
            ))}
          </ul>
          <Link to="/pantry" className="btn-quiet btn-link">
            냉장고 전체 보기
          </Link>
        </section>
      )}

      {todaysPlan.length > 0 && (
        <section className="card stack" aria-labelledby="today-plan-heading">
          <h2 id="today-plan-heading">오늘의 식단</h2>
          <ul className="today-plan-list">
            {SLOTS.filter(slot => todaysPlan.some(p => p.slot === slot)).map(slot => {
              const entry = todaysPlan.find(p => p.slot === slot)!;
              const recipe = entry.recipeId ? recipesById.get(entry.recipeId) : undefined;
              return (
                <li key={slot} className="today-plan-row">
                  <span className="muted">{SLOT_LABELS[slot]}</span>
                  {recipe ? (
                    <Link to={`/recipes/${recipe.id}`}>{recipe.title}</Link>
                  ) : (
                    <span>{entry.dishes?.map(d => d.title).join(' · ') || entry.freeText || '—'}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
