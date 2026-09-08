import { Suspense, lazy } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { BookOpen, CalendarDays, ChefHat, Refrigerator, Settings as SettingsIcon } from 'lucide-react';
import Home from './routes/Home';
import Recipes from './routes/Recipes';
import RecipeImport from './routes/RecipeImport';
import RecipeDetail from './routes/RecipeDetail';
import RecipeEdit from './routes/RecipeEdit';
import Pantry from './routes/Pantry';
import Plan from './routes/Plan';
import Settings from './routes/Settings';
import CookMode from './routes/CookMode';
import './App.css';

// Split shared-server screens out of the main bundle. @supabase/supabase-js must
// not be part of what the kitchen downloads to cook offline (docs/design.md E6).
const Restaurant = lazy(() => import('./routes/Restaurant'));
const CloudAccess = lazy(() => import('./routes/CloudAccess'));

// Bottom tabs, one column, max 640px (docs/design.md layout decision). Cook mode
// will be a sibling full-screen route OUTSIDE this shell so the tab bar cannot be
// hit with a wet hand mid-recipe (E2/E4) — added in M2.
const TABS = [
  { to: '/', label: '홈', Icon: ChefHat, end: true },
  { to: '/recipes', label: '레시피', Icon: BookOpen, end: false },
  { to: '/pantry', label: '냉장고', Icon: Refrigerator, end: false },
  { to: '/plan', label: '계획', Icon: CalendarDays, end: false },
  { to: '/settings', label: '설정', Icon: SettingsIcon, end: false },
] as const;

export default function App() {
  return (
    <Routes>
      {/* Cook mode sits OUTSIDE the shell: no tab bar to hit by accident with a
          wet hand mid-recipe (docs/design.md E2/E4). */}
      <Route path="/recipes/:id/cook" element={<CookMode />} />
      <Route path="/orders/:orderId/cook/:id" element={<CookMode />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}

function Shell() {
  return (
    <div className="app-shell">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/restaurant"
            element={
              <Suspense fallback={<p>식당을 여는 중…</p>}>
                <Restaurant />
              </Suspense>
            }
          />
          <Route
            path="/cloud-access"
            element={
              <Suspense fallback={<p>계정 화면을 여는 중…</p>}>
                <CloudAccess />
              </Suspense>
            }
          />
          <Route path="/recipes" element={<Recipes />} />
          <Route path="/recipes/import" element={<RecipeImport />} />
          <Route path="/recipes/:id" element={<RecipeDetail />} />
          <Route path="/recipes/:id/edit" element={<RecipeEdit />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="tab-bar" aria-label="주 메뉴">
        {TABS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => (isActive ? "tab active" : "tab")}
          >
            {/* Icon is decorative — the visible label carries the meaning, so
                status is never conveyed by glyph alone (docs/design.md §6). */}
            <Icon size={24} strokeWidth={2} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
