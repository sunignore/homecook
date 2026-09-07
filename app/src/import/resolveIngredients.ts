// Resolves parsed ingredient names against the archive's canonical Ingredient
// table (ADR-0002). This is the step that decides whether importing a recipe
// grows a coherent ingredient vocabulary or a pile of near-duplicates.
//
// Pure: takes the existing ingredients as an argument rather than reading the
// database, so the matching rules are testable on their own.

import type { Ingredient, IngredientCategory } from '../db/types';
import type { ParsedIngredient } from './parseRecipeText';

export interface IngredientResolution {
  parsed: ParsedIngredient;
  /** The existing ingredient this resolves to, if one matched. */
  match?: Ingredient;
  /** How it matched — surfaced so a wrong guess is visible, not silent. */
  via?: 'name' | 'alias';
}

/**
 * Normalize for comparison.
 *
 * Korean compounds are written with inconsistent spacing — "다진 마늘" and
 * "다진마늘" are the same ingredient and must not become two records — so
 * whitespace is removed entirely rather than merely collapsed.
 */
export function normalizeIngredientName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '');
}

/** Match one parsed name against the archive. */
export function findIngredient(
  name: string,
  existing: readonly Ingredient[],
): { match: Ingredient; via: 'name' | 'alias' } | undefined {
  const key = normalizeIngredientName(name);
  if (!key) return undefined;

  const byName = existing.find(i => normalizeIngredientName(i.name) === key);
  if (byName) return { match: byName, via: 'name' };

  const byAlias = existing.find(i =>
    i.aliases.some(alias => normalizeIngredientName(alias) === key),
  );
  if (byAlias) return { match: byAlias, via: 'alias' };

  return undefined;
}

/**
 * Resolve a whole parsed ingredient list.
 *
 * Entries with no match are returned unmatched rather than auto-created: the
 * correction UI shows them as new so the user can merge into an existing
 * ingredient instead of silently forking the vocabulary.
 */
export function resolveIngredients(
  parsed: readonly ParsedIngredient[],
  existing: readonly Ingredient[],
): IngredientResolution[] {
  return parsed.map(p => {
    const found = findIngredient(p.name, existing);
    return found ? { parsed: p, match: found.match, via: found.via } : { parsed: p };
  });
}

/** Ingredients in this import that do not exist in the archive yet. */
export function newIngredientNames(resolutions: readonly IngredientResolution[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const r of resolutions) {
    if (r.match) continue;
    const key = normalizeIngredientName(r.parsed.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(r.parsed.name.trim());
  }
  return names;
}

/**
 * Best-effort category guess for a newly created ingredient.
 *
 * Only a hint for the correction UI's preselected value — the user can change
 * it, and 'other' is always an acceptable answer. Deliberately small: a large
 * built-in dictionary is a maintenance burden nobody asked for (ADR-0002).
 */
const CATEGORY_HINTS: ReadonlyArray<readonly [IngredientCategory, RegExp]> = [
  ['sauce', /장$|간장|고추장|된장|소금|설탕|식초|기름|참기름|들기름|액젓|맛술|후추|고춧가루|다시다|소스|sauce|oil|vinegar|salt|sugar/],
  ['meat', /고기|목살|삼겹|앞다리|등심|안심|갈비|닭|오리|베이컨|햄|소시지|beef|pork|chicken|bacon/],
  ['seafood', /생선|고등어|꽁치|참치|오징어|새우|조개|멸치|해물|김$|미역|다시마|fish|shrimp|squid|anchovy/],
  ['dairy', /우유|치즈|버터|생크림|요거트|계란|달걀|milk|cheese|butter|cream|egg/],
  ['grain', /쌀|밥|면|국수|당면|파스타|스파게티|빵|밀가루|전분|rice|noodle|pasta|flour|bread/],
  ['vegetable', /파$|양파|대파|마늘|생강|고추|당근|감자|고구마|배추|무$|버섯|호박|시금치|콩나물|김치|묵은지|신김치|겉절이|두부|토마토|오이|가지|onion|garlic|carrot|potato|tomato|mushroom/],
];

export function guessCategory(name: string): IngredientCategory {
  for (const [category, pattern] of CATEGORY_HINTS) {
    if (pattern.test(name)) return category;
  }
  return 'other';
}

/** Staples are assumed always present and excluded from M3 scoring. */
const STAPLE_PATTERN = /^(소금|설탕|후추|간장|국간장|진간장|식용유|올리브유|참기름|들기름|식초|물|salt|sugar|pepper|water|oil)$/;

export function guessIsStaple(name: string): boolean {
  return STAPLE_PATTERN.test(normalizeIngredientName(name));
}
