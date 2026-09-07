import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Download, HardDrive, ShieldCheck, Upload } from 'lucide-react';
import { db } from '../db/db';
import {
  backupFileName,
  backupIsStale,
  exportBackup,
  lastBackupAt,
  readBackup,
  recordBackupTaken,
  restoreBackup,
  type RestorePreview,
} from '../backup/backup';
import './Settings.css';

// Because there is no server copy (ADR-0001), this screen is the app's entire
// durability story. It deliberately shows the uncomfortable numbers — whether
// the browser agreed to keep the data, and how long since the last export.

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Settings() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<RestorePreview | null>(null);
  const [lastBackup, setLastBackup] = useState<number | null>(() => lastBackupAt());
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<number | null>(null);

  const counts = useLiveQuery(async () => ({
    recipes: await db.recipes.count(),
    ingredients: await db.ingredients.count(),
    cookLogs: await db.cookLogs.count(),
    photos: await db.photos.count(),
  }));

  useEffect(() => {
    void (async () => {
      try {
        setPersisted((await navigator.storage?.persisted?.()) ?? null);
        const estimate = await navigator.storage?.estimate?.();
        setUsage(estimate?.usage ?? null);
      } catch {
        setPersisted(null);
      }
    })();
  }, [counts]);

  async function handleExport() {
    setBusy('export');
    setError(null);
    setDone(null);
    try {
      const blob = await exportBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName();
      // Anchor must be in the document for Firefox, and the object URL must
      // outlive the click — revoking synchronously after click() cancels the
      // download in some browsers, which would silently produce no file at the
      // exact moment the user believes they are covered.
      a.style.display = 'none';
      document.body.append(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 60_000);

      const at = Date.now();
      recordBackupTaken(at);
      setLastBackup(at);
      setDone(`백업 파일을 내려받았습니다 (${formatBytes(blob.size)}). 안전한 곳에 보관하세요.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '백업을 만들지 못했습니다.');
    } finally {
      setBusy(null);
    }
  }

  async function handleFileChosen(file: File) {
    setError(null);
    setDone(null);
    setPending(null);
    try {
      // Validated before anything is replaced, so a bad file cannot leave the
      // archive half-erased.
      setPending(await readBackup(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : '백업 파일을 읽지 못했습니다.');
    }
  }

  async function handleRestoreConfirmed() {
    if (!pending) return;
    setBusy('restore');
    setError(null);
    try {
      const restored = await restoreBackup(pending);
      setPending(null);
      setDone(
        `복원 완료 — 레시피 ${restored.recipes}개, 재료 ${restored.ingredients}개, 요리 기록 ${restored.cookLogs}개.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '복원하지 못했습니다. 기존 데이터는 그대로입니다.');
    } finally {
      setBusy(null);
    }
  }

  const stale = backupIsStale();
  const hasData = (counts?.recipes ?? 0) + (counts?.ingredients ?? 0) > 0;

  return (
    <div className="stack">
      <h1>설정</h1>

      <section className="card stack" aria-labelledby="storage-heading">
        <h2 id="storage-heading">저장소</h2>

        <p className="muted">
          모든 데이터는 이 브라우저 안에만 있습니다. 서버에 사본이 없으므로 백업 파일이
          유일한 안전망입니다.
        </p>

        <dl className="kv">
          <div>
            <dt>레시피</dt>
            <dd className="numeric">{counts?.recipes ?? '—'}</dd>
          </div>
          <div>
            <dt>재료</dt>
            <dd className="numeric">{counts?.ingredients ?? '—'}</dd>
          </div>
          <div>
            <dt>요리 기록</dt>
            <dd className="numeric">{counts?.cookLogs ?? '—'}</dd>
          </div>
          <div>
            <dt>사용 용량</dt>
            <dd className="numeric">{usage === null ? '—' : formatBytes(usage)}</dd>
          </div>
        </dl>

        {/* Status is icon + text + colour together (docs/design.md §6). */}
        {persisted === true ? (
          <p className="banner banner-ok">
            <ShieldCheck size={20} strokeWidth={2} aria-hidden="true" />
            <span>브라우저가 이 데이터를 보존 대상으로 표시했습니다. 그래도 백업은 필요합니다.</span>
          </p>
        ) : (
          <p className="banner banner-warn">
            <AlertTriangle size={20} strokeWidth={2} aria-hidden="true" />
            <span>
              저장 공간이 부족하면 브라우저가 이 데이터를 지울 수 있습니다. 사이트 데이터
              삭제로도 사라집니다.
            </span>
          </p>
        )}
      </section>

      <section className="card stack" aria-labelledby="backup-heading">
        <h2 id="backup-heading">백업</h2>

        <p className={stale && hasData ? 'banner banner-warn' : 'muted'}>
          {stale && hasData && <AlertTriangle size={20} strokeWidth={2} aria-hidden="true" />}
          <span>
            {lastBackup === null
              ? '아직 백업한 적이 없습니다.'
              : `마지막 백업: ${formatDate(lastBackup)}`}
          </span>
        </p>

        <div className="actions">
          <button type="button" className="btn-primary" onClick={handleExport} disabled={busy !== null}>
            <Download size={20} strokeWidth={2} aria-hidden="true" />
            {busy === 'export' ? '만드는 중…' : '백업 내보내기'}
          </button>

          <button
            type="button"
            className="btn-quiet"
            onClick={() => fileInput.current?.click()}
            disabled={busy !== null}
          >
            <Upload size={20} strokeWidth={2} aria-hidden="true" />
            복원하기
          </button>

          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void handleFileChosen(file);
            }}
          />
        </div>

        <p className="muted hint">
          <HardDrive size={16} strokeWidth={2} aria-hidden="true" />
          내려받은 <code>.zip</code> 파일 하나에 레시피·재료·요리 기록·사진이 모두 들어 있습니다.
        </p>
      </section>

      {pending && (
        <section className="card stack confirm" aria-labelledby="confirm-heading">
          <h2 id="confirm-heading">복원하면 지금 데이터가 사라집니다</h2>
          <p>
            복원은 합치는 것이 아니라 <strong>전체 교체</strong>입니다. 지금 이 기기에 있는
            레시피 {counts?.recipes ?? 0}개는 백업 파일의 내용으로 바뀝니다.
          </p>
          <dl className="kv">
            <div>
              <dt>백업 날짜</dt>
              <dd>{formatDate(pending.manifest.exportedAt)}</dd>
            </div>
            <div>
              <dt>레시피</dt>
              <dd className="numeric">{pending.manifest.counts.recipes}</dd>
            </div>
            <div>
              <dt>재료</dt>
              <dd className="numeric">{pending.manifest.counts.ingredients}</dd>
            </div>
            <div>
              <dt>요리 기록</dt>
              <dd className="numeric">{pending.manifest.counts.cookLogs}</dd>
            </div>
          </dl>
          <div className="actions">
            <button
              type="button"
              className="btn-danger"
              onClick={handleRestoreConfirmed}
              disabled={busy !== null}
            >
              {busy === 'restore' ? '복원 중…' : '전체 교체하고 복원'}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setPending(null)}>
              취소
            </button>
          </div>
        </section>
      )}

      {error && (
        <p className="banner banner-error" role="alert">
          <AlertTriangle size={20} strokeWidth={2} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {done && (
        <p className="banner banner-ok" role="status">
          <ShieldCheck size={20} strokeWidth={2} aria-hidden="true" />
          <span>{done}</span>
        </p>
      )}
    </div>
  );
}
