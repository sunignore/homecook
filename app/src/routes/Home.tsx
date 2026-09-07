import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

// M1 stub. In M3 this becomes the suggestion surface ("what can I cook now",
// plus the "one ingredient away" section) — product-brief §5.
export default function Home() {
  // useLiveQuery is the single reactive read path; there is no server cache to
  // mirror, so no query/state library is layered on top (ADR-0001).
  const counts = useLiveQuery(async () => ({
    recipes: await db.recipes.count(),
    logs: await db.cookLogs.count(),
    ingredients: await db.ingredients.count(),
  }));

  return (
    <div className="stack">
      <h1>오늘 뭐 먹지</h1>

      <section className="card stack" aria-labelledby="db-status">
        <h2 id="db-status">저장소 상태</h2>
        {counts === undefined ? (
          <p className="muted">불러오는 중…</p>
        ) : (
          <dl className="stat-list">
            <div>
              <dt>레시피</dt>
              <dd className="numeric">{counts.recipes}</dd>
            </div>
            <div>
              <dt>요리 기록</dt>
              <dd className="numeric">{counts.logs}</dd>
            </div>
            <div>
              <dt>재료</dt>
              <dd className="numeric">{counts.ingredients}</dd>
            </div>
          </dl>
        )}
        <p className="muted">
          M1 진행 중 — 레시피 아카이브와 요리 기록이 먼저 들어옵니다.
        </p>
      </section>
    </div>
  );
}
