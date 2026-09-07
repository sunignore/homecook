// Paste-to-parse recipe import — the mitigation for product-brief §4 Risk A.
//
// The parser does not need to be right. It needs to be right often enough that
// correcting a draft beats typing from scratch (~80%, product-brief §4). So it
// is deliberately permissive: anything it cannot classify is returned in
// `unparsed` for the correction UI to show, never silently dropped.
//
// Pure functions, no DOM and no database — the correction UI resolves parsed
// ingredient names to Ingredient records (ADR-0002); parsing stays independent
// of what is already in the archive so it can be unit-tested against real
// pasted sources.

export interface ParsedIngredient {
  /** Raw ingredient name as written. Resolved to an Ingredient by the caller. */
  name: string;
  /** null means "to taste" (약간 / 적당량) — a real value, not a parse failure. */
  qty: number | null;
  unit: string;
  note?: string;
  /**
   * Marked optional by the source, e.g. "청양고추 1개 (선택)".
   * M3 scoring counts only non-optional ingredients as required, so losing this
   * at parse time would make every suggestion stricter than the recipe is.
   */
  optional: boolean;
  /** The source line, so the correction UI can show what this came from. */
  raw: string;
}

export interface ParsedStep {
  text: string;
  /** Seconds, from phrases like "15분간 끓인다". Lower bound on a range. */
  durationSec?: number;
}

export interface ParsedRecipe {
  title?: string;
  servings?: number;
  ingredients: ParsedIngredient[];
  steps: ParsedStep[];
  /** Lines the parser could not classify. Shown, never discarded. */
  unparsed: string[];
}

// ── vocabulary ───────────────────────────────────────────────────────────────

// A heading line is the keyword ALONE (plus decoration, an optional colon and an
// optional parenthetical such as "(2인분)") — never a sentence that merely
// contains the word.
//
// Note the absence of a trailing \b. JS word boundaries are defined on
// [A-Za-z0-9_], so \b after a Hangul syllable never matches at end of line, and
// including one silently disables every Korean heading.
const HEADING_DECORATION = String.raw`^[\[\]{}【】#*=~\-–—•·▪◆■●▶▷▣※\s]*`;
// The trailing `[\]】]?` closes bracketed headings — 만개의레시피 and most Korean
// recipe sites label sections as `[재료]` / `[양념]`, and without this the closing
// bracket fails the anchor and no section is ever recognised.
const HEADING_TAIL = String.raw`\s*[:：]?\s*(?:[(（][^)）]*[)）])?\s*[\]】]?\s*[:：]?\s*$`;

const INGREDIENT_HEADING = new RegExp(
  HEADING_DECORATION +
    String.raw`(?:[주부]?\s?재\s?료(?:\s*준비)?|준비\s*물|양념(?:장)?(?:\s*재료)?|ingredients?)` +
    HEADING_TAIL,
  'i',
);

const STEP_HEADING = new RegExp(
  HEADING_DECORATION +
    String.raw`(?:만드는\s*법|조리\s*법|조리\s*순서|조리\s*방법|레시피\s*순서|순서|과정|steps?|(?:cooking\s*)?instructions?|directions?|method)` +
    HEADING_TAIL,
  'i',
);

/** Units we recognise after a quantity. Longest-first so 큰술 beats 술. */
const UNITS = [
  '큰술', '작은술', '테이블스푼', '티스푼', '스푼', '컵', '공기', '봉지', '봉', '캔', '팩',
  '마리', '조각', '토막', '줌', '꼬집', '톨', '쪽', '장', '알', '모', '단', '대', '개',
  'kg', 'g', 'ml', 'mL', 'L', 'l', 'cc', 'oz', 'lb',
  'tbsp', 'tsp', 'cup', 'cups',
  'cloves', 'clove', 'slices', 'slice', 'pieces', 'piece', 'sprigs', 'sprig', 'cans', 'can',
  'T', 't',
];

/** Phrases that mean "an unmeasured amount" rather than a failed parse. */
const TO_TASTE = ['약간', '적당량', '적당히', '조금', '기호껏', '기호에 따라', 'to taste', 'a pinch'];

/**
 * Boilerplate that trails video descriptions and blog posts. Without this it
 * lands in `steps` and shows up mid-recipe in cook mode, which is exactly where
 * a stray line is most disruptive.
 */
/** Marks an ingredient the recipe treats as optional. */
const OPTIONAL_NOTE = /선택|생략\s*가능|없어도|optional|to taste if/i;

const PROMO = /구독|좋아요|알림\s*설정|채널|인스타|블로그\s*방문|협찬|광고\s*문의|비즈니스\s*문의|저작권|무단\s*전재|subscribe|follow me|affiliate/i;

const BULLET = /^\s*(?:[-–—•·*▪◦]|\d+[.)]|[①-⑳])\s*/;
const STEP_NUMBER = /^\s*(?:(\d+)\s*[.)]|[①-⑳])\s*/;

// ── helpers ──────────────────────────────────────────────────────────────────

/** "1/2" → 0.5, "1과 1/2" → 1.5, "2~3" → 2 (lower bound), "1.5" → 1.5. */
function parseQuantity(text: string): number | null {
  const t = text.trim().replace(/\s*[~〜–—-]\s*\d+(?:\.\d+)?(?:\/\d+)?\s*$/, ''); // range → lower bound

  const mixed = /^(\d+)\s*(?:과|and)?\s+(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    return den === 0 ? null : whole + num / den;
  }

  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (fraction) {
    const den = Number(fraction[2]);
    return den === 0 ? null : Number(fraction[1]) / den;
  }

  const plain = /^\d+(?:\.\d+)?$/.exec(t);
  return plain ? Number(t) : null;
}

const UNIT_ALTERNATION = UNITS.slice()
  .sort((a, b) => b.length - a.length)
  .map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

/** Quantity + optional unit, e.g. "2큰술", "1/2 모", "300g", "1대". */
const QTY_UNIT = new RegExp(
  String.raw`(\d+(?:\.\d+)?(?:\s*[~〜–—-]\s*\d+(?:\.\d+)?)?(?:\s*\/\s*\d+)?(?:\s*과\s*\d+\s*\/\s*\d+)?)\s*(${UNIT_ALTERNATION})?`,
);

/**
 * Lift a parenthetical out of a phrase, wherever it sits.
 *
 * Sources put it mid-phrase ("돼지고기(목살) 200g") and trailing
 * ("청양고추 1개 (선택)") about equally often, so anchoring to the end misses
 * half of them.
 */
function stripNote(name: string): { name: string; note?: string } {
  const paren = /[(（]([^)）]*)[)）]/.exec(name);
  if (!paren) return { name: name.trim() };

  const note = paren[1]?.trim();
  const cleaned = `${name.slice(0, paren.index)} ${name.slice(paren.index + paren[0].length)}`
    .replace(/\s+/g, ' ')
    .trim();

  return { name: cleaned, note: note || undefined };
}

// ── ingredient lines ─────────────────────────────────────────────────────────

/**
 * Parse one ingredient phrase. Handles both orders, because pasted Korean
 * sources write "대파 1대" while English ones write "2 tbsp soy sauce".
 */
export function parseIngredientPhrase(phrase: string, raw = phrase): ParsedIngredient | null {
  const stripped = phrase.replace(BULLET, '').trim();
  if (!stripped) return null;

  // Parentheticals come out FIRST, before any quantity matching. A trailing
  // note — "청양고추 1개 (선택)" — otherwise sits between the quantity and the
  // end of the string and defeats the quantity-last anchor, leaving the amount
  // stranded inside the name.
  const { name: text, note: parenNote } = stripNote(stripped);
  if (!text) return null;

  const finish = (
    fields: Pick<ParsedIngredient, 'name' | 'qty' | 'unit'>,
    extraNote?: string,
  ): ParsedIngredient => {
    const note = [parenNote, extraNote].filter(Boolean).join(' ') || undefined;
    return { ...fields, note, optional: OPTIONAL_NOTE.test(note ?? ''), raw };
  };

  // "소금 약간" — an unmeasured amount, not a parse failure.
  const toTaste = TO_TASTE.find(w => text.toLowerCase().endsWith(w.toLowerCase()));
  if (toTaste) {
    const name = text.slice(0, text.length - toTaste.length).trim().replace(/[:：]$/, '');
    if (!name) return null;
    return finish({ name, qty: null, unit: '' }, parenNote ? undefined : toTaste);
  }

  // Quantity-first (English convention): "2 tbsp soy sauce", "300g chicken".
  const leading = new RegExp(String.raw`^${QTY_UNIT.source}\s+(.+)$`).exec(text);
  if (leading?.[3]) {
    return finish({
      name: leading[3].trim(),
      qty: parseQuantity(leading[1]!),
      unit: leading[2] ?? '',
    });
  }

  // Quantity-last (Korean convention): "대파 1대", "두부 1/2모".
  const trailing = new RegExp(String.raw`^(.+?)\s*${QTY_UNIT.source}\s*$`).exec(text);
  if (trailing?.[1] && trailing[2]) {
    const name = trailing[1].trim();
    if (name) {
      return finish({ name, qty: parseQuantity(trailing[2]), unit: trailing[3] ?? '' });
    }
  }

  // A bare name with no quantity is still a usable ingredient — either the
  // amount follows on the next line (see parsePureAmount) or the correction UI
  // fills it in. Reject anything sentence-shaped.
  if (text.length <= 30 && !/[.!?]$/.test(text)) {
    const { name, note: altNote } = splitAlternativeNote(text.replace(/[:：]$/, ''));
    if (name) return finish({ name, qty: null, unit: '' }, altNote);
  }

  return null;
}

/**
 * Match a line that is ONLY an amount — "700ml", "1/2개", "1T", "3줌", "약간".
 *
 * Korean recipe sites (만개의레시피 and the many layouts copied from it) render
 * the ingredient name and its amount in separate cells, so a paste alternates
 * name line / amount line. Without this, every amount line becomes a bogus
 * ingredient literally named "700ml".
 */
export function parsePureAmount(line: string): { qty: number | null; unit: string } | null {
  const t = line.trim();
  if (!t) return null;
  if (TO_TASTE.some(w => t.toLowerCase() === w.toLowerCase())) return { qty: null, unit: '' };

  const m = new RegExp(String.raw`^${QTY_UNIT.source}$`).exec(t);
  if (!m?.[1]) return null;
  return { qty: parseQuantity(m[1]), unit: m[2] ?? '' };
}

/** A bracketed line that is not a known section heading, e.g. "[고기와김치의비율(3:1)]". */
function isBracketedAside(line: string): boolean {
  return /^\s*[[【].*[\]】]\s*$/.test(line);
}

/** Split a trailing substitution note: "돼지고기목살 또는삼겹살". */
function splitAlternativeNote(name: string): { name: string; note?: string } {
  const m = /^(.*?)\s*(또는\s*.+|or\s+.+)$/i.exec(name.trim());
  if (m?.[1]) return { name: m[1].trim(), note: m[2]?.trim() };
  return { name: name.trim() };
}

/** Split "대파 1대, 양파 1개" into separate ingredient phrases. */
function splitIngredientLine(line: string): string[] {
  return line
    .split(/\s*[,،]\s*|\s+\/\s+/)
    .map(part => part.trim())
    .filter(Boolean);
}

// ── steps ────────────────────────────────────────────────────────────────────

/**
 * Extract a timer duration from step text.
 *
 * Takes the LOWER bound of a range ("10~15분" → 10 min): a timer that fires
 * early prompts a check, while one that fires late means burnt food.
 */
export function extractDurationSec(text: string): number | undefined {
  const hm = /(\d+)\s*시간(?:\s*(\d+)\s*분)?/.exec(text);
  if (hm) {
    return Number(hm[1]) * 3600 + (hm[2] ? Number(hm[2]) * 60 : 0);
  }

  const min = /(\d+)(?:\s*[~〜–—-]\s*\d+)?\s*분/.exec(text);
  if (min) return Number(min[1]) * 60;

  const sec = /(\d+)(?:\s*[~〜–—-]\s*\d+)?\s*초/.exec(text);
  if (sec) return Number(sec[1]);

  const enMin = /(\d+)(?:\s*[-–—]\s*\d+)?\s*(?:minutes?|mins?)\b/i.exec(text);
  if (enMin) return Number(enMin[1]) * 60;

  return undefined;
}

// ── document ─────────────────────────────────────────────────────────────────

function parseServings(line: string): number | undefined {
  const m = /(\d+)\s*(?:인분|인\s*기준|servings?|serves)/i.exec(line);
  return m ? Number(m[1]) : undefined;
}

type Section = 'preamble' | 'ingredients' | 'steps';

/**
 * Parse pasted recipe text into a structured draft.
 *
 * Never throws and never silently drops a line: unclassifiable content lands in
 * `unparsed` so the correction UI can surface it.
 */
export function parseRecipeText(input: string): ParsedRecipe {
  const lines = input.replace(/\r\n?/g, '\n').split('\n');

  const result: ParsedRecipe = { ingredients: [], steps: [], unparsed: [] };
  let section: Section = 'preamble';
  let sawIngredientHeading = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (PROMO.test(line)) {
      result.unparsed.push(line);
      continue;
    }

    const servings = parseServings(line);
    if (servings !== undefined && result.servings === undefined) {
      result.servings = servings;
    }

    if (INGREDIENT_HEADING.test(line)) {
      section = 'ingredients';
      sawIngredientHeading = true;
      continue;
    }
    if (STEP_HEADING.test(line)) {
      section = 'steps';
      continue;
    }

    if (section === 'preamble') {
      if (result.title === undefined && !/^\d/.test(line)) {
        // "김치찌개 만들기" / "김치찌개 레시피" → "김치찌개"
        // "잡채 (4인분) 만들기" → "잡채". The serving count is captured
        // separately above, so leaving it in the title just duplicates it.
        result.title =
          line
            .replace(/\s*[(（][^)）]*(?:인분|인\s*기준|servings?|serves)[^)）]*[)）]\s*/gi, ' ')
            .replace(/\s*(만들기|만드는\s*법|레시피|recipe)\s*$/i, '')
            .replace(/\s+/g, ' ')
            .trim() || line;
      } else if (servings === undefined) {
        result.unparsed.push(line);
      }
      continue;
    }

    if (section === 'ingredients') {
      // A numbered line inside the ingredient block usually means the source
      // never wrote a step heading; treat it as the start of the steps.
      if (STEP_NUMBER.test(line) && sawIngredientHeading && result.ingredients.length > 0) {
        section = 'steps';
      } else if (isBracketedAside(line)) {
        // A bracketed line that is not a section heading is an aside, not an
        // ingredient — e.g. a ratio hint like "[고기와김치의비율(3:1)]".
        result.unparsed.push(line);
        continue;
      } else {
        // An amount on its own line belongs to the ingredient above it.
        const amount = parsePureAmount(line);
        if (amount) {
          const prev = result.ingredients[result.ingredients.length - 1];
          if (!prev) {
            result.unparsed.push(line);
            continue;
          }
          if (prev.qty !== null) {
            // The name line already carried a measure, so this is a second one.
            // The dedicated amount line is the canonical figure (e.g. "700ml");
            // demote the colloquial one from the name line into the note
            // ("종이컵 5컵"). The name itself may still be imperfect in this
            // shape — that is what the correction UI is for.
            const demoted = `${prev.qty}${prev.unit}`.trim();
            prev.note = prev.note ? `${prev.note} (${demoted})` : demoted;
          }
          prev.qty = amount.qty;
          prev.unit = amount.unit;
          prev.raw = `${prev.raw} / ${line}`;
          continue;
        }

        const parts = splitIngredientLine(line);
        const parsed = parts
          .map(part => parseIngredientPhrase(part, line))
          .filter((i): i is ParsedIngredient => i !== null);

        if (parsed.length > 0) result.ingredients.push(...parsed);
        else result.unparsed.push(line);
        continue;
      }
    }

    // section === 'steps'
    const text = line.replace(STEP_NUMBER, '').trim();
    if (!text) continue;
    const durationSec = extractDurationSec(text);
    result.steps.push(durationSec === undefined ? { text } : { text, durationSec });
  }

  return result;
}
