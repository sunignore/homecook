import { useEffect, useId, useState } from 'react';
import { AlertTriangle, KeyRound, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { ZodError } from 'zod';
import {
  accessCodeSchema,
  bootstrapCloud,
  cloudAuthContext,
  cloudAuthStatus,
  generateAccessCode,
  loginCloud,
  logoutCloud,
  revokeCloudSessions,
  setCloudCode,
  type CloudAuthStatus,
  type CloudContext,
  type CloudRole,
} from '../household/cloudAuth';
import './CloudAccess.css';

function message(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? '입력값을 확인해주세요.';
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
}

export default function CloudAccess() {
  const errorId = useId();
  const [status, setStatus] = useState<CloudAuthStatus | null>(null);
  const [context, setContext] = useState<CloudContext | null>(null);
  const [role, setRole] = useState<CloudRole>('husband');
  const [code, setCode] = useState('');
  const [persist, setPersist] = useState(true);
  const [bootstrapSecret, setBootstrapSecret] = useState('');
  const [householdName, setHouseholdName] = useState('우리집 식당');
  const [targetRole, setTargetRole] = useState<CloudRole>('wife');
  const [newCode, setNewCode] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.allSettled([cloudAuthStatus(), cloudAuthContext()]).then(([statusResult, contextResult]) => {
      if (!active) return;
      if (statusResult.status === 'fulfilled') setStatus(statusResult.value);
      else setError(message(statusResult.reason));
      if (contextResult.status === 'fulfilled') setContext(contextResult.value);
    });
    return () => { active = false; };
  }, []);

  async function run(name: string, action: () => Promise<void>, success: string) {
    setBusy(name); setError(''); setDone('');
    try {
      await action();
      setDone(success);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy('');
    }
  }

  async function handleLogin() {
    const next = await loginCloud(role, code, persist);
    setContext(next);
    setCode('');
  }

  async function handleBootstrap() {
    const next = await bootstrapCloud(bootstrapSecret, householdName, code, persist);
    setContext(next);
    setStatus({ initialized: true, wifeConfigured: false });
    setBootstrapSecret('');
    setCode('');
  }

  async function handleCodeChange() {
    accessCodeSchema.parse(newCode);
    await setCloudCode(targetRole, newCode);
    setNewCode('');
    if (targetRole === 'wife') setStatus(previous => previous && { ...previous, wifeConfigured: true });
  }

  async function handleLogout() {
    await logoutCloud();
    setContext(null);
  }

  const disabled = Boolean(busy);
  return <div className="stack cloud-access">
    <header className="stack">
      <h1>우리집 계정</h1>
      <p className="muted">남편과 아내 중 역할을 고르고, 관리자가 정한 코드로 어느 기기에서나 로그인합니다.</p>
    </header>

    {error && <p id={errorId} className="banner banner-error" role="alert">
      <AlertTriangle size={20} aria-hidden="true" /><span>{error}</span>
    </p>}
    {done && <p className="banner banner-ok" role="status">
      <ShieldCheck size={20} aria-hidden="true" /><span>{done}</span>
    </p>}
    {!status && !error && <p role="status">계정 상태를 확인하는 중…</p>}

    {status && !status.initialized && !context && <form className="card stack" aria-labelledby="bootstrap-heading" onSubmit={event => {
      event.preventDefault();
      void run('bootstrap', handleBootstrap, '우리집 계정을 만들고 남편으로 로그인했습니다.');
    }}>
      <h2 id="bootstrap-heading">처음 한 번만 설정</h2>
      <p className="muted">배포 관리자가 전달한 초기 설정 비밀값과 남편의 로그인 코드를 입력하세요.</p>
      <label className="field">식당 이름
        <input required maxLength={80} autoComplete="organization" value={householdName}
          onChange={event => setHouseholdName(event.target.value)} aria-describedby={error ? errorId : undefined} />
      </label>
      <label className="field">초기 설정 비밀값
        <input required type="password" minLength={24} autoComplete="off" value={bootstrapSecret}
          onChange={event => setBootstrapSecret(event.target.value)} aria-describedby={error ? errorId : undefined} />
      </label>
      <CodeField value={code} onChange={setCode} label="남편 로그인 코드" autoComplete="new-password" errorId={error ? errorId : undefined} />
      <Persistence checked={persist} onChange={setPersist} />
      <button className="btn-primary" disabled={disabled}>{busy === 'bootstrap' ? '설정 중…' : '우리집 계정 만들기'}</button>
    </form>}

    {status?.initialized && !context && <form className="card stack" aria-labelledby="login-heading" onSubmit={event => {
      event.preventDefault();
      void run('login', handleLogin, '로그인했습니다.');
    }}>
      <h2 id="login-heading">로그인</h2>
      <fieldset className="role-picker">
        <legend>누구로 사용할까요?</legend>
        <label><input type="radio" name="role" value="husband" checked={role === 'husband'}
          onChange={() => setRole('husband')} /> 남편</label>
        <label><input type="radio" name="role" value="wife" checked={role === 'wife'}
          onChange={() => setRole('wife')} /> 아내</label>
      </fieldset>
      <CodeField value={code} onChange={setCode} label="로그인 코드" errorId={error ? errorId : undefined} />
      <Persistence checked={persist} onChange={setPersist} />
      <button className="btn-primary" disabled={disabled}>{busy === 'login' ? '로그인 중…' : '로그인'}</button>
      {role === 'wife' && !status.wifeConfigured && <p className="banner banner-warn">남편이 먼저 아내 코드를 설정해야 합니다.</p>}
    </form>}

    {context && <section className="card stack" aria-labelledby="account-heading">
      <h2 id="account-heading">{context.name}</h2>
      <p><strong>{context.role === 'husband' ? '남편' : '아내'}</strong>으로 로그인했습니다.</p>
      <button className="btn-quiet" disabled={disabled} onClick={() => void run('logout', handleLogout, '이 기기에서 로그아웃했습니다.')}>
        <LogOut size={20} aria-hidden="true" /> 로그아웃
      </button>
    </section>}

    {context?.role === 'husband' && <section className="card stack" aria-labelledby="admin-heading">
      <h2 id="admin-heading">로그인 코드 관리</h2>
      <p className="muted">코드 변경은 다음 로그인부터 적용됩니다. 현재 로그인된 기기를 즉시 끊으려면 전체 로그아웃을 따로 실행하세요.</p>
      <label className="field">대상
        <select value={targetRole} onChange={event => setTargetRole(event.target.value as CloudRole)}>
          <option value="wife">아내</option><option value="husband">남편</option>
        </select>
      </label>
      <CodeField value={newCode} onChange={setNewCode} label="새 로그인 코드" autoComplete="new-password" errorId={error ? errorId : undefined} />
      <div className="actions cloud-actions">
        <button type="button" className="btn-quiet" disabled={disabled} onClick={() => setNewCode(generateAccessCode())}>
          <KeyRound size={20} aria-hidden="true" /> 안전한 코드 만들기
        </button>
        <button type="button" className="btn-primary" disabled={disabled} onClick={() =>
          void run('set-code', handleCodeChange, (targetRole === 'husband' ? '남편' : '아내') + ' 코드를 저장했습니다.')}>
          {busy === 'set-code' ? '저장 중…' : '코드 저장'}
        </button>
      </div>
      <div className="access-revoke">
        <p>분실한 기기가 있으면 해당 역할의 모든 로그인 상태를 해제하세요.</p>
        <button type="button" className="btn-danger" disabled={disabled} onClick={() => void run('revoke', async () => {
          await revokeCloudSessions(targetRole);
          if (targetRole === 'husband') {
            await logoutCloud();
            setContext(null);
          }
        }, (targetRole === 'husband' ? '남편' : '아내') + '의 모든 기기를 로그아웃했습니다.')}>
          <RefreshCw size={20} aria-hidden="true" /> {targetRole === 'husband' ? '남편' : '아내'} 전체 로그아웃
        </button>
      </div>
    </section>}
  </div>;
}

function CodeField({ value, onChange, label, errorId, autoComplete = 'current-password' }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  errorId?: string;
  autoComplete?: 'current-password' | 'new-password';
}) {
  const [visible, setVisible] = useState(false);
  return <div className="field">
    <label className="field">{label}
      <input type={visible ? 'text' : 'password'} required minLength={12} maxLength={64} autoComplete={autoComplete}
        value={value} onChange={event => onChange(event.target.value)}
        aria-invalid={Boolean(errorId)} aria-describedby={errorId} />
    </label>
    <div className="code-help-row">
      <span className="muted field-help">12~64자, 영문과 숫자를 포함하세요.</span>
      <button type="button" className="btn-quiet" aria-pressed={visible} onClick={() => setVisible(current => !current)}>
        {visible ? '코드 숨기기' : '코드 보기'}
      </button>
    </div>
  </div>;
}

function Persistence({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="persistence-choice">
    <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    <span><strong>이 기기에 로그인 유지</strong><small>개인 휴대폰에서만 켜세요. 끄면 브라우저를 닫을 때 로그인이 사라집니다.</small></span>
  </label>;
}
