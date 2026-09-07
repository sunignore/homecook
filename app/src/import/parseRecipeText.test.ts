import { describe, expect, it } from 'vitest';
import {
  extractDurationSec,
  parseIngredientPhrase,
  parseRecipeText,
} from './parseRecipeText';

// Fixtures are shaped like real pasted sources (Korean blog posts, YouTube
// descriptions), because the parser's only job is to beat typing on THOSE —
// product-brief §4 Risk A.

describe('parseIngredientPhrase', () => {
  it('parses the Korean quantity-last convention', () => {
    expect(parseIngredientPhrase('대파 1대')).toMatchObject({ name: '대파', qty: 1, unit: '대' });
  });

  it('parses the English quantity-first convention', () => {
    expect(parseIngredientPhrase('2 tbsp soy sauce')).toMatchObject({
      name: 'soy sauce',
      qty: 2,
      unit: 'tbsp',
    });
  });

  it('parses a metric amount with no space', () => {
    expect(parseIngredientPhrase('돼지고기 300g')).toMatchObject({
      name: '돼지고기',
      qty: 300,
      unit: 'g',
    });
  });

  it('parses fractions', () => {
    expect(parseIngredientPhrase('두부 1/2모')).toMatchObject({ name: '두부', qty: 0.5, unit: '모' });
  });

  it('parses mixed numbers', () => {
    expect(parseIngredientPhrase('밥 1과 1/2공기')).toMatchObject({ qty: 1.5, unit: '공기' });
  });

  it('takes the lower bound of a range', () => {
    expect(parseIngredientPhrase('청양고추 2~3개')).toMatchObject({ qty: 2, unit: '개' });
  });

  it('treats "약간" as to-taste rather than a parse failure', () => {
    const parsed = parseIngredientPhrase('소금 약간');
    expect(parsed).toMatchObject({ name: '소금', qty: null });
    expect(parsed?.note).toBe('약간');
  });

  it('prefers the longest matching unit', () => {
    expect(parseIngredientPhrase('고춧가루 2큰술')).toMatchObject({ qty: 2, unit: '큰술' });
    expect(parseIngredientPhrase('참기름 1작은술')).toMatchObject({ qty: 1, unit: '작은술' });
  });

  it('pulls a parenthesised note out of the name', () => {
    expect(parseIngredientPhrase('돼지고기(목살) 200g')).toMatchObject({
      name: '돼지고기',
      note: '목살',
      qty: 200,
      unit: 'g',
    });
  });

  it('strips list bullets', () => {
    expect(parseIngredientPhrase('- 양파 1개')).toMatchObject({ name: '양파', qty: 1 });
    expect(parseIngredientPhrase('• 마늘 3톨')).toMatchObject({ name: '마늘', qty: 3, unit: '톨' });
  });

  it('keeps a bare ingredient with no amount', () => {
    expect(parseIngredientPhrase('김')).toMatchObject({ name: '김', qty: null, unit: '' });
  });

  it('rejects a sentence', () => {
    expect(parseIngredientPhrase('팬에 기름을 두르고 고기를 볶아주세요.')).toBeNull();
  });
});

describe('extractDurationSec', () => {
  it.each([
    ['15분간 끓인다', 900],
    ['30초 정도 데친다', 30],
    ['1시간 30분 재워둔다', 5400],
    ['2시간 끓인다', 7200],
    ['simmer for 20 minutes', 1200],
  ])('%s → %i seconds', (text, expected) => {
    expect(extractDurationSec(text)).toBe(expected);
  });

  it('takes the lower bound of a range so the timer prompts a check early', () => {
    expect(extractDurationSec('10~15분간 조린다')).toBe(600);
  });

  it('returns undefined when there is no duration', () => {
    expect(extractDurationSec('한소끔 끓으면 불을 끈다')).toBeUndefined();
  });
});

const KIMCHI_JJIGAE = `김치찌개 만들기

재료 (2인분)
- 신김치 300g
- 돼지고기(목살) 200g
- 두부 1/2모
- 대파 1대
- 다진마늘 1큰술
- 고춧가루 2큰술
- 소금 약간

만드는 법
1. 팬에 기름을 두르고 돼지고기를 볶는다.
2. 김치를 넣고 5분간 더 볶는다.
3. 물 500ml를 붓고 15분간 끓인다.
4. 두부와 대파를 넣고 5분 더 끓인 후 불을 끈다.
`;

describe('parseRecipeText', () => {
  const parsed = parseRecipeText(KIMCHI_JJIGAE);

  it('takes the title from the first line and drops the trailing "만들기"', () => {
    expect(parsed.title).toBe('김치찌개');
  });

  it('reads the serving count', () => {
    expect(parsed.servings).toBe(2);
  });

  it('parses every ingredient line', () => {
    expect(parsed.ingredients).toHaveLength(7);
    expect(parsed.ingredients.map(i => i.name)).toEqual([
      '신김치',
      '돼지고기',
      '두부',
      '대파',
      '다진마늘',
      '고춧가루',
      '소금',
    ]);
  });

  it('does not mistake a step for an ingredient', () => {
    expect(parsed.ingredients.some(i => i.name.includes('팬에'))).toBe(false);
  });

  it('parses the steps and strips their numbering', () => {
    expect(parsed.steps).toHaveLength(4);
    expect(parsed.steps[0]?.text).toBe('팬에 기름을 두르고 돼지고기를 볶는다.');
  });

  it('extracts timers from steps, which is what M2 consumes', () => {
    expect(parsed.steps.map(s => s.durationSec)).toEqual([undefined, 300, 900, 300]);
  });

  it('keeps the original line on each ingredient for the correction UI', () => {
    expect(parsed.ingredients[1]?.raw).toBe('- 돼지고기(목살) 200g');
  });
});

describe('parseRecipeText — messier sources', () => {
  it('splits several ingredients written on one line', () => {
    const parsed = parseRecipeText('재료\n대파 1대, 양파 1개, 마늘 3톨');
    expect(parsed.ingredients.map(i => i.name)).toEqual(['대파', '양파', '마늘']);
  });

  it('falls back to numbered lines when the source has no step heading', () => {
    const parsed = parseRecipeText('된장찌개\n\n재료\n- 두부 1모\n- 애호박 1/2개\n\n1. 물을 끓인다.\n2. 된장을 푼다.');
    expect(parsed.ingredients).toHaveLength(2);
    expect(parsed.steps.map(s => s.text)).toEqual(['물을 끓인다.', '된장을 푼다.']);
  });

  it('recognises an English ingredient heading', () => {
    const parsed = parseRecipeText('Pasta\n\nIngredients\n- 200g spaghetti\n\nInstructions\n1. Boil for 9 minutes.');
    expect(parsed.ingredients[0]).toMatchObject({ name: 'spaghetti', qty: 200, unit: 'g' });
    expect(parsed.steps[0]?.durationSec).toBe(540);
  });

  it('surfaces unclassifiable lines instead of dropping them', () => {
    const parsed = parseRecipeText('김밥\n구독과 좋아요 부탁드립니다\n\n재료\n- 김 5장');
    expect(parsed.unparsed).toContain('구독과 좋아요 부탁드립니다');
    expect(parsed.ingredients).toHaveLength(1);
  });

  it('handles CRLF input from a copied web page', () => {
    const parsed = parseRecipeText('계란말이\r\n\r\n재료\r\n- 계란 3알\r\n\r\n만드는 법\r\n1. 잘 푼다.');
    expect(parsed.ingredients[0]).toMatchObject({ name: '계란', qty: 3, unit: '알' });
    expect(parsed.steps).toHaveLength(1);
  });

  it('never throws on empty or junk input', () => {
    expect(() => parseRecipeText('')).not.toThrow();
    expect(parseRecipeText('').ingredients).toEqual([]);
    expect(() => parseRecipeText('....\n\n\n')).not.toThrow();
  });
});
