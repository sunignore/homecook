import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronLeft, ChevronRight, Pause, Play, Plus, RotateCcw, X } from 'lucide-react';
import { db } from '../db/db';
import {
  clampStep,
  clearSession,
  loadSession,
  newSession,
  saveSession,
  type CookSession,
} from '../cook/session';
import {
  extendTimer,
  formatDuration,
  pauseTimer,
  progress,
  remainingSeconds,
  resetTimer,
  startTimer,
  tickTimers,
  announceRemaining,
} from '../cook/timers';
import { playAlarm, primeAlarm, vibrateAlarm } from '../cook/alarm';
import { useWakeLock } from '../cook/useWakeLock';
import './CookMode.css';

// Full-screen and outside the tab bar on purpose: an accidental tap with a wet
// hand must not navigate away mid-recipe (docs/design.md E2/E4).

export default function CookMode() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const recipe = useLiveQuery(() => (id ? db.recipes.get(id) : undefined), [id]);
  const [session, setSession] = useState<CookSession | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [alerted, setAlerted] = useState<string[]>([]);
  const alarmedIds = useRef(new Set<string>());

  const { held: screenHeld, supported: wakeLockSupported } = useWakeLock(session !== null);

  // Restore the session for this recipe, or start one.
  useEffect(() => {
    if (!recipe) return;
    setSession(prev => prev ?? loadSession(recipe.id) ?? newSession(recipe.id, recipe.steps));
    void primeAlarm();
  }, [recipe]);

  // One clock for the whole screen. Every countdown is derived from it, so
  // nothing accumulates drift and a backgrounded tab simply catches up.
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 250);
    const onVisible = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(handle);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Fire the alarm for anything that finished, including while hidden.
  useEffect(() => {
    if (!session) return;
    const { timers, justFinished } = tickTimers(session.timers, now);
    if (justFinished.length === 0) return;

    const fresh = justFinished.filter(t => !alarmedIds.current.has(t.id));
    if (fresh.length > 0) {
      fresh.forEach(t => alarmedIds.current.add(t.id));
      playAlarm();
      vibrateAlarm();
      setAlerted(prev => [...prev, ...fresh.map(t => t.id)]);
    }
    update({ ...session, timers });
  }, [now, session]);

  const update = useCallback((next: CookSession) => {
    setSession(next);
    saveSession(next);
  }, []);

  if (recipe === undefined) return <p className="muted cook-loading">불러오는 중…</p>;
  if (!recipe || recipe.steps.length === 0) {
    return (
      <div className="cook-shell cook-empty">
        <p>조리 단계가 없는 레시피입니다.</p>
        <button type="button" className="cook-btn" onClick={() => navigate(`/recipes/${id}`)}>
          돌아가기
        </button>
      </div>
    );
  }
  if (!session) return <p className="muted cook-loading">준비 중…</p>;

  const stepIndex = clampStep(session.stepIndex, recipe.steps.length);
  const step = recipe.steps[stepIndex]!;
  const isLast = stepIndex === recipe.steps.length - 1;
  const runningTimers = session.timers.filter(t => t.status !== 'idle');

  function goto(index: number) {
    update({ ...session!, stepIndex: clampStep(index, recipe!.steps.length) });
  }

  function mutateTimer(timerId: string, fn: (t: CookSession['timers'][number]) => CookSession['timers'][number]) {
    const at = Date.now();
    // Advance the display clock to the same instant the timer was changed.
    // Otherwise the readout is computed against a clock up to one tick stale and
    // a freshly started 5:00 renders as 5:01 — visibly wrong at the exact moment
    // the user pressed the button.
    setNow(at);
    update({
      ...session!,
      timers: session!.timers.map(t => (t.id === timerId ? fn(t) : t)),
    });
    setAlerted(prev => prev.filter(pid => pid !== timerId));
    alarmedIds.current.delete(timerId);
  }

  function handleExit() {
    // Leaving is deliberate: timers are still running and the position is kept.
    navigate(`/recipes/${recipe!.id}`);
  }

  function handleFinish() {
    clearSession();
    navigate(`/recipes/${recipe!.id}?logged=1`);
  }

  const stepTimer = session.timers.find(t => t.stepIndex === stepIndex);

  return (
    <div className="cook-shell">
      <header className="cook-head">
        <button type="button" className="cook-icon-btn" onClick={handleExit} aria-label="조리 모드 나가기">
          <X size={28} strokeWidth={2} aria-hidden="true" />
        </button>
        <div className="cook-progress numeric" aria-live="off">
          {stepIndex + 1} / {recipe.steps.length}
        </div>
        {/* Says plainly whether the screen will stay on — guessing is worse. */}
        <span className="cook-wake muted">
          {wakeLockSupported ? (screenHeld ? '화면 켜짐' : '화면 꺼질 수 있음') : ''}
        </span>
      </header>

      {runningTimers.length > 0 && (
        <section className="timer-rail" aria-label="타이머">
          {runningTimers.map(timer => {
            const left = remainingSeconds(timer, now);
            const finished = timer.status === 'done';
            return (
              <article
                key={timer.id}
                className={finished ? 'timer-card timer-done' : 'timer-card'}
              >
                <div className="timer-top">
                  <button
                    type="button"
                    className="timer-step-link"
                    onClick={() => goto(timer.stepIndex)}
                  >
                    {timer.stepIndex + 1}단계
                  </button>
                  {/* Status is text + colour together, never colour alone. */}
                  {finished && <span className="timer-flag">완료</span>}
                </div>

                <output className="timer-readout numeric" aria-live="off">
                  {formatDuration(left)}
                </output>

                {/* Announced sparingly so a screen reader is not swamped. */}
                <span className="sr-only" aria-live="polite">
                  {finished ? `${timer.stepIndex + 1}단계 타이머 완료` : ''}
                </span>

                <div
                  className="timer-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={timer.durationSec}
                  aria-valuenow={timer.durationSec - left}
                  aria-valuetext={finished ? '완료' : announceRemaining(left)}
                >
                  <span style={{ width: `${Math.round(progress(timer, now) * 100)}%` }} />
                </div>

                <div className="timer-actions">
                  {timer.status === 'running' ? (
                    <button
                      type="button"
                      className="cook-btn cook-btn-quiet"
                      onClick={() => mutateTimer(timer.id, t => pauseTimer(t, Date.now()))}
                    >
                      <Pause size={24} strokeWidth={2} aria-hidden="true" />
                      일시정지
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="cook-btn cook-btn-quiet"
                      onClick={() => mutateTimer(timer.id, t => startTimer(t, Date.now()))}
                    >
                      <Play size={24} strokeWidth={2} aria-hidden="true" />
                      {finished ? '다시' : '계속'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="cook-btn cook-btn-quiet"
                    onClick={() => mutateTimer(timer.id, t => extendTimer(t, 60, Date.now()))}
                    aria-label="1분 추가"
                  >
                    <Plus size={24} strokeWidth={2} aria-hidden="true" />
                    1분
                  </button>
                  <button
                    type="button"
                    className="cook-btn cook-btn-quiet"
                    onClick={() => mutateTimer(timer.id, resetTimer)}
                    aria-label="타이머 초기화"
                  >
                    <RotateCcw size={24} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <main className="cook-main">
        <p className="cook-step">{step.text}</p>

        {step.durationSec !== undefined && stepTimer && stepTimer.status === 'idle' && (
          <button
            type="button"
            className="cook-btn cook-btn-primary"
            onClick={() => mutateTimer(stepTimer.id, t => startTimer(t, Date.now()))}
          >
            <Play size={28} strokeWidth={2} aria-hidden="true" />
            {Math.round(step.durationSec / 60)}분 타이머 시작
          </button>
        )}
      </main>

      <nav className="cook-nav" aria-label="단계 이동">
        <button
          type="button"
          className="cook-btn cook-btn-quiet"
          onClick={() => goto(stepIndex - 1)}
          disabled={stepIndex === 0}
        >
          <ChevronLeft size={32} strokeWidth={2} aria-hidden="true" />
          이전
        </button>

        {isLast ? (
          <button type="button" className="cook-btn cook-btn-primary" onClick={handleFinish}>
            <Check size={32} strokeWidth={2} aria-hidden="true" />
            완료
          </button>
        ) : (
          <button
            type="button"
            className="cook-btn cook-btn-primary"
            onClick={() => goto(stepIndex + 1)}
          >
            다음
            <ChevronRight size={32} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </nav>

      {alerted.length > 0 && (
        <p className="cook-alert" role="alert">
          타이머 {alerted.length}개 완료
        </p>
      )}
    </div>
  );
}
