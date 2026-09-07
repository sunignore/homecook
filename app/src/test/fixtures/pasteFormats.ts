// Parser fixtures.
//
// These are ORIGINAL texts written for this repository. They are not copied from
// any recipe site or video — what is reproduced here is the *shape* of common
// paste formats (section labels, line breaks, bullet styles, unit conventions),
// which is what the parser actually has to cope with. Recipe content itself is
// deliberately plain and generic.
//
// Format survey performed 2026-09-07 against publicly rendered Korean recipe
// pages. The three structural findings that drove parser changes:
//
//   1. Section labels are bracketed — `[재료]`, `[양념]`.
//   2. Ingredient name and amount are rendered in separate cells, so a paste
//      alternates name line / amount line. This is the dominant format and the
//      one the parser originally failed completely.
//   3. Step numbering is visual, not textual — copied steps arrive as unnumbered
//      paragraphs.
//
// When a real paste fails, add it here (lightly rewritten) rather than patching
// the parser blind.

/** Format A — the dominant site layout: bracketed sections, alternating lines. */
export const FORMAT_A_ALTERNATING = `[재료]
쌀뜨물
700ml
돼지고기 목살
300g
묵은지
3줌
대파
1/2개
청양고추
1개
두부
1/2모
[양념]
국간장
1T
고춧가루
1/2T
다진 마늘
1/2T
설탕
1작은술`;

/** Format B — blog post: heading, hyphen bullets, numbered steps. */
export const FORMAT_B_BLOG = `된장찌개 만들기

재료 (2인분)
- 애호박 1/2개
- 감자 1개
- 양파 1/2개
- 두부 1/2모
- 표고버섯 2개
- 된장 2큰술
- 다진마늘 1작은술
- 멸치육수 500ml
- 소금 약간

만드는 법
1. 멸치육수를 끓인다.
2. 된장을 체에 걸러 푼 뒤 감자를 넣고 5분간 끓인다.
3. 애호박, 양파, 표고버섯을 넣고 7분 더 끓인다.
4. 두부를 넣고 3분간 끓인 후 불을 끈다.`;

/** Format C — video description: inline label, no step heading, no numbering. */
export const FORMAT_C_VIDEO = `계란말이 레시피

재료:
계란 4알, 당근 1/4개, 대파 1대, 소금 약간, 식용유 적당량

조리 순서
계란을 풀고 소금으로 간한다.
당근과 대파를 잘게 다져 계란물에 섞는다.
약불에서 3~4분간 천천히 말아준다.
한 김 식힌 뒤 먹기 좋게 썬다.

구독과 좋아요 부탁드립니다`;

/** Format D — bracketed asides and a substitution note mixed into the list. */
export const FORMAT_D_ASIDES = `제육볶음

[재료]
돼지고기 앞다리살 또는 목살
600g
양파
1개
대파
1대
[고기와양념의비율(3:1)]
[양념]
고추장
3큰술
고춧가루
2큰술
간장
1큰술
설탕
1큰술
다진마늘
1큰술`;

/** Format E — English source, quantity-first. */
export const FORMAT_E_ENGLISH = `Simple Tomato Pasta

Ingredients
- 200g spaghetti
- 2 tbsp olive oil
- 3 cloves garlic
- 400g canned tomatoes
- 1 tsp salt

Instructions
1. Boil the spaghetti for 9 minutes.
2. Warm the olive oil and cook the garlic for 1 minute.
3. Add the tomatoes and simmer for 15 minutes.
4. Toss the drained pasta through the sauce.`;

/** Format F — 주재료 / 부재료 split, several ingredients per line. */
export const FORMAT_F_SUBSECTIONS = `잡채 (4인분)

주재료
당면 200g, 시금치 1줌, 당근 1/2개

부재료
양파 1/2개, 표고버섯 3개, 소고기 150g

양념
간장 4큰술, 설탕 2큰술, 참기름 2큰술, 깨 1작은술

조리법
1. 당면을 8분간 삶아 찬물에 헹군다.
2. 시금치를 30초간 데친다.
3. 채소와 소고기를 각각 볶는다.
4. 모든 재료를 양념에 버무린다.`;

export const ALL_FIXTURES = [
  { name: 'A — alternating name/amount lines', text: FORMAT_A_ALTERNATING },
  { name: 'B — blog with bullets', text: FORMAT_B_BLOG },
  { name: 'C — video description', text: FORMAT_C_VIDEO },
  { name: 'D — bracketed asides', text: FORMAT_D_ASIDES },
  { name: 'E — English', text: FORMAT_E_ENGLISH },
  { name: 'F — sub-sections', text: FORMAT_F_SUBSECTIONS },
] as const;
