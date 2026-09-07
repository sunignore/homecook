import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import RecipeDraftForm, { type DraftStep } from '../components/RecipeDraftForm';
import { parseRecipeText } from '../import/parseRecipeText';
import { importRecipe, type DraftIngredient } from '../import/importRecipe';

// The correction step, not the parse step, is what makes importing beat typing:
// the parser only has to be ~80% right if fixing the rest is fast
// (docs/product-brief.md §4 Risk A).

interface Parsed {
  title: string;
  servings: number;
  rows: DraftIngredient[];
  steps: DraftStep[];
  unparsed: string[];
}

export default function RecipeImport() {
  const navigate = useNavigate();
  const [sourceText, setSourceText] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);

  function handleParse() {
    const result = parseRecipeText(sourceText);
    setParsed({
      title: result.title ?? '',
      servings: result.servings ?? 2,
      rows: result.ingredients.map(i => ({
        name: i.name,
        qty: i.qty,
        unit: i.unit,
        note: i.note,
        optional: i.optional,
      })),
      steps: result.steps.map((s, idx) => ({ ...s, key: `s${idx}` })),
      unparsed: result.unparsed,
    });
  }

  if (parsed) {
    return (
      <div className="stack">
        <h1>확인하고 고치기</h1>
        <RecipeDraftForm
          initialTitle={parsed.title}
          initialServings={parsed.servings}
          initialRows={parsed.rows}
          initialSteps={parsed.steps}
          unparsed={parsed.unparsed}
          submitLabel="저장"
          secondaryLabel="원문 고치기"
          onSecondary={() => setParsed(null)}
          onSubmit={async draft => {
            const id = await importRecipe({ ...draft, tags: [], sourceText });
            navigate(`/recipes/${id}`);
          }}
        />
      </div>
    );
  }

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
