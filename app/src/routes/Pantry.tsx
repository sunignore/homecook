import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertCircle, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { db } from '../db/db';
import { getOrCreateIngredient } from '../ingredients/getOrCreateIngredient';
import {
  addPantryItem,
  deletePantryItem,
  isExpired,
  isExpiringSoon,
  sortByExpiry,
  updatePantryItem,
} from '../pantry/pantry';
import type { PantryLocation } from '../db/types';
import './Pantry.css';

const LOCATION_LABELS: Record<PantryLocation, string> = {
  fridge: '냉장',
  freezer: '냉동',
  pantry: '실온',
};

const LOCATIONS: PantryLocation[] = ['fridge', 'freezer', 'pantry'];

/** yyyy-MM-dd for an <input type="date">, in local time — a UTC conversion
 *  would show the wrong day for anything stored near midnight. */
function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInputValue(value: string): number | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d).getTime();
}

function daysUntil(ms: number, now: number): number {
  return Math.ceil((ms - now) / (24 * 60 * 60 * 1000));
}

function expiryLabel(ms: number, now: number): string {
  const days = daysUntil(ms, now);
  if (days < 0) return `${Math.abs(days)}일 지남`;
  if (days === 0) return '오늘까지';
  return `D-${days}`;
}

export default function Pantry() {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [location, setLocation] = useState<PantryLocation>('fridge');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const pantryItems = useLiveQuery(() => db.pantryItems.toArray());
  const ingredients = useLiveQuery(() => db.ingredients.toArray(), [], []);
  const ingredientsById = useMemo(() => new Map(ingredients.map(i => [i.id, i])), [ingredients]);

  const sorted = useMemo(() => sortByExpiry(pantryItems ?? []), [pantryItems]);
  const expiringCount = sorted.filter(i => isExpiringSoon(i, now) || isExpired(i, now)).length;

  async function handleAdd() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const ingredient = await getOrCreateIngredient(name);
      await addPantryItem({
        ingredientId: ingredient.id,
        qty: Number(qty) || 0,
        unit: unit.trim() || ingredient.defaultUnit,
        location,
        boughtAt: now,
        expiresAt: fromDateInputValue(expiresAt),
      });
      setName('');
      setQty('');
      setUnit('');
      setExpiresAt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '추가하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <h1>냉장고</h1>

      {expiringCount > 0 && (
        <p className="banner banner-warn">
          <AlertTriangle size={20} strokeWidth={2} aria-hidden="true" />
          <span>
            유통기한이 임박했거나 지난 재료가 <strong>{expiringCount}개</strong> 있습니다.
          </span>
        </p>
      )}

      <form
        className="card stack"
        onSubmit={e => {
          e.preventDefault();
          void handleAdd();
        }}
        aria-labelledby="add-heading"
      >
        <h2 id="add-heading">재료 추가</h2>
        <div className="pantry-add-row">
          <input
            className="pantry-add-name"
            list="pantry-ingredient-options"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="재료 이름"
            aria-label="재료 이름"
          />
          <datalist id="pantry-ingredient-options">
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
        </div>
        <div className="pantry-add-row">
          <select
            className="pantry-add-location"
            value={location}
            onChange={e => setLocation(e.target.value as PantryLocation)}
            aria-label="보관 위치"
          >
            {LOCATIONS.map(loc => (
              <option key={loc} value={loc}>
                {LOCATION_LABELS[loc]}
              </option>
            ))}
          </select>
          <input
            className="pantry-add-expiry"
            type="date"
            value={expiresAt}
            onChange={e => setExpiresAt(e.target.value)}
            aria-label="유통기한"
          />
          <button type="submit" className="btn-primary" disabled={saving || !name.trim()}>
            <Plus size={20} strokeWidth={2} aria-hidden="true" />
            {saving ? '추가 중…' : '추가'}
          </button>
        </div>

        {error && (
          <p className="banner banner-error" role="alert">
            <AlertCircle size={20} strokeWidth={2} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </form>

      {pantryItems === undefined ? (
        <p className="muted">불러오는 중…</p>
      ) : sorted.length === 0 ? (
        <p className="muted">아직 등록된 재료가 없습니다.</p>
      ) : (
        <ul className="pantry-list">
          {sorted.map(item => {
            const ingredient = ingredientsById.get(item.ingredientId);
            const expired = isExpired(item, now);
            const soon = isExpiringSoon(item, now);
            return (
              <li key={item.id} className="pantry-row">
                <div className="pantry-row-head">
                  <span className="pantry-name">{ingredient?.name ?? '알 수 없는 재료'}</span>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => void deletePantryItem(item.id)}
                    aria-label={`${ingredient?.name ?? '재료'} 다 썼어요`}
                  >
                    <Trash2 size={20} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>

                <div className="pantry-row-fields">
                  <input
                    className="pantry-qty numeric"
                    value={item.qty}
                    inputMode="decimal"
                    onChange={e => {
                      const n = Number(e.target.value);
                      // Clamped: a negative quantity is meaningless and would
                      // subtract from the shopping list's pantry total.
                      if (Number.isFinite(n)) {
                        void updatePantryItem(item.id, { qty: Math.max(0, n) });
                      }
                    }}
                    aria-label={`${ingredient?.name ?? '재료'} 수량`}
                  />
                  <span className="muted">{item.unit}</span>
                  <select
                    className="pantry-location"
                    value={item.location}
                    onChange={e =>
                      void updatePantryItem(item.id, { location: e.target.value as PantryLocation })
                    }
                    aria-label={`${ingredient?.name ?? '재료'} 보관 위치`}
                  >
                    {LOCATIONS.map(loc => (
                      <option key={loc} value={loc}>
                        {LOCATION_LABELS[loc]}
                      </option>
                    ))}
                  </select>
                  <input
                    className="pantry-expiry"
                    type="date"
                    value={item.expiresAt ? toDateInputValue(item.expiresAt) : ''}
                    onChange={e =>
                      void updatePantryItem(item.id, { expiresAt: fromDateInputValue(e.target.value) })
                    }
                    aria-label={`${ingredient?.name ?? '재료'} 유통기한`}
                  />
                </div>

                {/* Status is icon + text + colour together (docs/design.md §6). */}
                {(expired || soon) && item.expiresAt !== undefined && (
                  <span className={expired ? 'tag tag-expired' : 'tag tag-soon'}>
                    <AlertTriangle size={14} strokeWidth={2.5} aria-hidden="true" />
                    {expiryLabel(item.expiresAt, now)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
