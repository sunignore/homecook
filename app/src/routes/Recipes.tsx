import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardPaste, Search } from 'lucide-react';
import { db } from '../db/db';
import RecipePhoto from '../components/RecipePhoto';
import './Recipes.css';

export default function Recipes() {
  const [query, setQuery] = useState('');
  // A tag link from a recipe filters the list; keeping it in the URL means the
  // filtered view is shareable and survives a refresh.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTag = searchParams.get('tag');

  const recipes = useLiveQuery(() => db.recipes.orderBy('updatedAt').reverse().toArray());

  const term = query.trim().toLowerCase();
  const shown = (recipes ?? [])
    .filter(r => !activeTag || r.tags.includes(activeTag))
    .filter(
      r =>
        !term ||
        r.title.toLowerCase().includes(term) ||
        r.tags.some(t => t.toLowerCase().includes(term)),
    );

  return (
    <div className="stack">
      <div className="page-head">
        <h1>레시피</h1>
        <Link to="/recipes/import" className="btn-primary btn-link">
          <ClipboardPaste size={20} strokeWidth={2} aria-hidden="true" />
          붙여넣기
        </Link>
      </div>

      {activeTag && (
        <p className="banner banner-ok">
          <span>
            <strong>{activeTag}</strong> 태그 {shown.length}개
          </span>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => setSearchParams({}, { replace: true })}
          >
            전체 보기
          </button>
        </p>
      )}

      {recipes !== undefined && recipes.length > 0 && (
        <label className="search">
          <Search size={20} strokeWidth={2} aria-hidden="true" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="제목이나 태그로 검색"
            aria-label="레시피 검색"
          />
        </label>
      )}

      {recipes === undefined ? (
        <p className="muted">불러오는 중…</p>
      ) : recipes.length === 0 ? (
        <div className="card stack empty">
          <h2>아직 레시피가 없습니다</h2>
          <p className="muted">
            블로그나 영상 설명란의 레시피를 통째로 붙여넣으면 재료와 조리 단계를 분리해
            초안을 만들어 드립니다. 손으로 하나씩 채워 넣지 않아도 됩니다.
          </p>
          <Link to="/recipes/import" className="btn-primary btn-link">
            <ClipboardPaste size={20} strokeWidth={2} aria-hidden="true" />
            레시피 붙여넣기
          </Link>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">"{query}"에 해당하는 레시피가 없습니다.</p>
      ) : (
        <ul className="recipe-list">
          {shown.map(recipe => (
            <li key={recipe.id}>
              <Link to={`/recipes/${recipe.id}`} className="recipe-card">
                <RecipePhoto
                  photoId={recipe.photoId}
                  alt={`${recipe.title} 사진`}
                  className="recipe-thumb"
                />
                <span className="recipe-title">{recipe.title}</span>
                <span className="muted recipe-sub numeric">
                  재료 {recipe.ingredients.length} · 단계 {recipe.steps.length} · {recipe.servings}
                  인분
                </span>
                {recipe.tags.length > 0 && (
                  <span className="recipe-tags">
                    {recipe.tags.map(t => (
                      <span key={t} className="tag tag-timer">
                        {t}
                      </span>
                    ))}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
