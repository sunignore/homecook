import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { exportBackup, backupFileName } from '../backup/backup';
import { command, configured, invite, join, localDish, migratePlans, recoverRecipe, refresh, server, subscribePush } from '../household/client';
import { snapshotSchema, slotLabels, statusLabels, type Command, type Order } from '../household/contracts';
import { useHousehold } from '../household/useHousehold';
import type { MealSlot } from '../db/types';
import './Restaurant.css';
import { z } from 'zod';

const savedDraftSchema = z.object({
  date: z.string().max(10), slot: z.enum(['breakfast', 'lunch', 'dinner']),
  diners: z.number().min(0).max(20), note: z.string().max(1000),
  selection: z.array(z.string().uuid()).max(20),
  versions: z.record(z.string(), z.number().int().positive()),
}).strict();

const actions: Record<string, string> = { submit: '주문', edit: '주문 수정', accept: '접수', reject: '거절', cancel: '취소', requestCancel: '취소 요청', declineCancel: '취소 요청 거절', cook: '조리 시작', ready: '준비 완료', thanks: '감사 인사' };
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

function MenuPhoto({ path }: { path?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true; let objectUrl = '';
    setUrl('');
    if (path) void (async () => {
      const cached = await db.householdPhotos.get(path);
      let photo = cached ? new Blob([cached.bytes], { type: cached.type }) : null;
      if (!photo) {
        const { data } = await server().storage.from('household-photos').download(path);
        photo = data;
        if (data) await db.householdPhotos.put({ id: path, bytes: await data.arrayBuffer(), type: data.type });
      }
      if (photo && active) { objectUrl = URL.createObjectURL(photo); setUrl(objectUrl); }
    })().catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  return url ? <img className="restaurant-photo" src={url} alt="" /> : null;
}

export default function Restaurant() {
  const { snapshot, error: syncError, loading } = useHousehold();
  const recipes = useLiveQuery(() => db.recipes.toArray(), [], []);
  const recovered = useLiveQuery(async () => (await db.householdRecovery.toArray()).map(row => snapshotSchema.parse(row.snapshot)), [], []);
  const [role, setRole] = useState<'husband' | 'wife'>('husband');
  const [token, setToken] = useState(() => {
    const found = new URLSearchParams(location.hash.slice(1)).get('invite') ?? '';
    if (found) history.replaceState(null, '', location.pathname);
    return found;
  });
  const [invitation, setInvitation] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<MealSlot>('dinner');
  const [diners, setDiners] = useState(2);
  const [note, setNote] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<Order | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [backupSaved, setBackupSaved] = useState(false);
  const running = useRef(false);
  const pending = useRef(new Map<string, string>());
  const draftKey = snapshot?.role === 'wife' ? 'homecook:orderDraft:' + snapshot.householdId : '';
  useEffect(() => {
    if (!draftKey) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const saved = savedDraftSchema.parse(JSON.parse(raw));
        setDate(saved.date); setSlot(saved.slot); setDiners(saved.diners); setNote(saved.note); setSelection(saved.selection); setVersions(saved.versions);
      }
    } catch { setError('저장된 주문 초안을 읽지 못했습니다. 메뉴를 다시 선택해주세요.'); }
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey || editing) return;
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify({ date, slot, diners, note, selection, versions })); }
      catch { setError('이 기기에 주문 초안을 저장하지 못했습니다.'); }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draftKey, date, slot, diners, note, selection, versions, editing]);
  useEffect(() => {
    if (snapshot && location.hash.startsWith('#order-')) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [snapshot?.householdId, snapshot?.orders.length]);

  async function run(task: () => Promise<unknown>, success: string) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setMessage('');
    try { await task(); setMessage(success); }
    catch (e) { setError(e instanceof Error ? e.message : '처리하지 못했습니다. 다시 시도해주세요.'); }
    finally { running.current = false; setBusy(false); }
  }
  async function send(body: Command) {
    const signature = JSON.stringify(body);
    const key = pending.current.get(signature) ?? crypto.randomUUID();
    pending.current.set(signature, key);
    await command(body, key);
    pending.current.delete(signature);
  }
  function act(order: Order, action: 'accept' | 'reject' | 'cancel' | 'requestCancel' | 'declineCancel' | 'cook' | 'ready' | 'thanks') {
    void run(() => send({ action, id: order.id, version: order.version, comment: comments[order.id] ?? '' }), '주문서에 반영했습니다.');
  }
  function edit(order: Order) {
    setEditing(order); setDate(order.date); setSlot(order.slot); setDiners(order.diners); setNote(order.note);
    setSelection(order.items.map(i => i.id));
    setVersions(Object.fromEntries(order.items.map(i => [i.id, snapshot?.menu.find(m => m.id === i.id)?.version ?? 1])));
    document.getElementById('menu-heading')?.scrollIntoView({ block: 'start' });
  }
  const chef = snapshot?.role === 'husband';
  return <div className="stack restaurant">
    <div className="page-head"><h1>{snapshot?.name ?? '우리집 식당'}</h1><Link to="/">홈</Link></div>
    <p className="muted">먹고 싶은 한 끼를 주문하고, 함께 준비해요.</p>
    {(error || syncError) && <p className="banner banner-error" role="alert">{error || syncError} 저장된 내용은 최근 확인 시점의 상태입니다.</p>}
    <p role="status" aria-live="polite">{busy ? '처리 중…' : message}</p>
    {!configured ? <section className="card stack"><h2>식당 오픈 준비 중</h2><p>공유 서버 연결을 설정하면 두 휴대폰에서 주문을 주고받을 수 있습니다. 기존 레시피와 조리 기능은 계속 사용할 수 있어요.</p><Link to="/recipes">레시피 보기</Link></section>
    : loading && !snapshot ? <p>식당을 확인하고 있어요…</p>
    : !snapshot ? <form className="card stack" onSubmit={e => { e.preventDefault(); void run(() => join(token.trim(), role), '기기를 연결했습니다.'); }}>
      <h2>누가 사용하시나요?</h2>
      <label className="field">역할<select value={role} onChange={e => setRole(e.target.value as typeof role)}><option value="husband">남편 · 셰프</option><option value="wife">아내 · 손님</option></select></label>
      <label className="field">처음 한 번, 초대 코드<input value={token} onChange={e => setToken(e.target.value)} required autoComplete="off" spellCheck={false} /></label>
      <p className="muted">초대 링크를 열거나 전달받은 코드를 붙여넣어주세요. 연결 후에는 역할을 기억합니다.</p>
      <button className="btn-primary" disabled={busy}>우리 식당 연결하기</button>
    </form> : <>
      <section className="card stack">
        <h2>{chef ? '셰프의 주방' : '오늘의 손님'}</h2>
        <details><summary>기기 연결·알림 설정</summary><div className="stack">
          <p>아이폰 공유 메뉴에서 ‘홈 화면에 추가’한 뒤 앱을 열고 알림을 허용해주세요.</p>
          <button className="btn-quiet" disabled={busy} onClick={() => void run(subscribePush, '알림을 등록했습니다. 잠시 후 테스트 알림을 확인해주세요.')}>알림 켜고 테스트하기</button>
          <p className="muted">초대는 30분 동안 한 번 사용할 수 있어요. 새 기기가 연결되면 상대 역할의 이전 기기 연결을 해제합니다.</p>
          <button className="btn-quiet" disabled={busy} onClick={() => void run(async () => setInvitation(location.origin + '/restaurant#invite=' + await invite()), '초대 링크를 만들었습니다.')}>상대방 초대·기기 교체</button>
          {invitation && <label className="field">상대방에게 전달할 초대 링크<input readOnly value={invitation} onFocus={e => e.target.select()} /></label>}
          {chef && <form className="stack" onSubmit={e => { e.preventDefault(); void run(() => send({ action: 'name', name }), '식당 이름을 바꿨습니다.'); }}>
            <label className="field">식당 이름<input value={name} placeholder={snapshot.name} maxLength={80} onChange={e => setName(e.target.value)} required /></label><button className="btn-quiet" disabled={busy}>이름 저장</button>
          </form>}
        </div></details>
      </section>
      {chef && <section className="card stack">
        <h2>기존 레시피로 메뉴판 열기</h2>
        <p className="muted">백업을 보관한 뒤 공개할 레시피를 선택해주세요. 원본은 이 기기에 유지됩니다.</p>
        <button className="btn-quiet" disabled={busy} onClick={() => void run(async () => {
          const blob = await exportBackup(); const url = URL.createObjectURL(blob);
          const link = document.createElement('a'); link.href = url; link.download = backupFileName(); link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        }, '백업 파일 저장을 완료한 뒤 아래 확인란을 선택해주세요.')}>기존 데이터 백업 다운로드</button>
        <label><input type="checkbox" checked={backupSaved} onChange={e => setBackupSaved(e.target.checked)} /> 백업 파일을 저장했습니다</label>
        <button className="btn-quiet" disabled={busy || !backupSaved} onClick={() => void run(migratePlans, '기존 식단을 공유 식단에 연결했습니다.')}>{snapshot.calendarReady ? '추가 식단 연결하기' : '기존 식단 연결하기'}</button>
        {!snapshot.calendarReady && <p>주문 접수 전에 기존 식단 연결을 완료해주세요. 기존 식단이 없어도 한 번 눌러주세요.</p>}
        {recipes.length === 0 && <Link to="/recipes/import">레시피 등록하기</Link>}
        {recipes.map(recipe => {
          const published = snapshot.menu.find(m => m.id === recipe.id);
          return <div className="restaurant-row" key={recipe.id}><span>{recipe.title}</span>
            <button className="btn-quiet" disabled={busy || !backupSaved} onClick={() => void run(async () => send({
              action: 'publish', recipe: await localDish(recipe, true), available: !published?.available,
            }), '메뉴판에 반영했습니다.')}>{published?.available ? '주문 불가로' : '메뉴판에 공개'}</button>
            {published && <button className="btn-quiet" disabled={busy || !backupSaved} onClick={() => void run(async () => send({ action: 'publish', recipe: await localDish(recipe, true), available: published.available }), '최신 레시피로 갱신했습니다.')}>내용 갱신</button>}
          </div>;
        })}
      </section>}
      {!chef && <form className="card stack" onSubmit={e => {
        e.preventDefault();
        void run(async () => {
          const selected = selection.map(id => {
            const item = snapshot.menu.find(m => m.id === id && m.available);
            if (!item) throw new Error('주문할 수 없는 메뉴가 포함되어 있습니다. 다시 선택해주세요.');
            if (versions[id] !== item.version) throw new Error(item.recipe.title + ' 메뉴가 변경되었습니다. 선택을 해제하고 다시 확인해주세요.');
            return { id, version: versions[id]! };
          });
          await send(editing ? { action: 'edit', id: editing.id, version: editing.version, date, slot, diners, note, selection: selected } : { action: 'submit', date, slot, diners, note, selection: selected });
          if (draftKey) localStorage.removeItem(draftKey);
          setSelection([]); setNote(''); setEditing(null);
        }, '주문을 보냈습니다. 셰프의 접수를 기다려주세요.');
      }}>
        <h2 id="menu-heading">{editing ? '주문 수정' : '메뉴판'}</h2>
        <label className="field">날짜<input type="date" min={today()} required value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="field">식사<select value={slot} onChange={e => setSlot(e.target.value as MealSlot)}>{Object.entries(slotLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="field">인원<input type="number" min={1} max={20} step={1} required value={diners} onChange={e => setDiners(Number(e.target.value))} /></label>
        {snapshot.menu.filter(m => m.available).map(item => <label className="restaurant-menu" key={item.id}>
          <input type="checkbox" checked={selection.includes(item.id)} onChange={e => {
            const checked = e.target.checked;
            setSelection(prev => checked ? [...prev, item.id] : prev.filter(id => id !== item.id));
            if (checked) setVersions(prev => ({ ...prev, [item.id]: item.version }));
          }} />
          <MenuPhoto path={item.recipe.photoPath} /><span>{item.recipe.title}<small className="muted"> {item.recipe.tags.join(' · ')}</small></span>
        </label>)}
        {!snapshot.menu.some(m => m.available) && <p>셰프가 메뉴판을 준비하고 있어요.</p>}
        <label className="field">요청 사항<textarea value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="조금 덜 맵게 부탁해요" /></label>
        <p>{date} {slotLabels[slot]} · {diners}인 · {selection.length}개 메뉴</p>
        <button className="btn-primary" disabled={busy || selection.length === 0}>{editing ? '수정한 주문 보내기' : '이대로 주문하기'}</button>
        {editing && <button type="button" className="btn-quiet" onClick={() => { setEditing(null); setSelection([]); setNote(''); }}>수정 그만하기</button>}
      </form>}
      <section className="stack" aria-labelledby="orders-heading"><h2 id="orders-heading">{chef ? '주문함' : '나의 주문서'}</h2>
        {snapshot.orders.length === 0 && <p className="muted">아직 주문이 없습니다.</p>}
        {snapshot.orders.map(order => <article className="card stack restaurant-receipt" key={order.id} id={'order-' + order.id}>
          <h3>{order.date} {slotLabels[order.slot]} · {order.diners}인</h3>
          <strong>{statusLabels[order.status]}{order.cancellation ? ' · 취소 요청 대기' : ''}</strong>
          <ul>{order.items.map(item => <li key={item.id}>{item.title}
            {chef && ['accepted', 'cooking'].includes(order.status) && <Link className="btn-quiet" to={'/orders/' + order.id + '/cook/' + item.id}>조리하기</Link>}
          </li>)}</ul>
          {order.note && <p>요청: {order.note}</p>}
          <details><summary>주문 기록</summary><ol>{order.events.map((event, index) => <li key={index}>{actions[event.action] ?? event.action} · {new Date(event.at).toLocaleString('ko-KR')}{event.comment && <p>{event.comment}</p>}</li>)}</ol></details>
          {chef && !['rejected', 'cancelled', 'ready'].includes(order.status) && <label className="field">셰프의 의견 (거절·취소 시 필수)<textarea value={comments[order.id] ?? ''} maxLength={1000} onChange={e => setComments(prev => ({ ...prev, [order.id]: e.target.value }))} /></label>}
          <div className="restaurant-actions">
            {chef && order.status === 'pending' && <><button className="btn-primary" disabled={busy} onClick={() => act(order, 'accept')}>주문 접수</button><button className="btn-quiet" disabled={busy || !comments[order.id]?.trim()} onClick={() => act(order, 'reject')}>전체 거절</button></>}
            {!chef && order.status === 'pending' && <><button className="btn-quiet" disabled={busy} onClick={() => edit(order)}>수정</button><button className="btn-quiet" disabled={busy} onClick={() => act(order, 'cancel')}>주문 취소</button></>}
            {chef && order.status === 'accepted' && <button className="btn-primary" disabled={busy} onClick={() => act(order, 'cook')}>조리 시작</button>}
            {chef && ['accepted', 'cooking'].includes(order.status) && <button className="btn-quiet" disabled={busy || !comments[order.id]?.trim()} onClick={() => act(order, 'cancel')}>주문 전체 취소</button>}
            {chef && order.cancellation && <button className="btn-quiet" disabled={busy || !comments[order.id]?.trim()} onClick={() => act(order, 'declineCancel')}>취소 요청 거절</button>}
            {!chef && ['accepted', 'cooking'].includes(order.status) && !order.cancellation && <button className="btn-quiet" disabled={busy} onClick={() => act(order, 'requestCancel')}>취소 요청</button>}
            {chef && order.status === 'cooking' && <button className="btn-primary" disabled={busy || order.cancellation} onClick={() => act(order, 'ready')}>식사 준비 완료</button>}
            {!chef && order.status === 'ready' && !order.thanks && <button className="btn-primary" disabled={busy} onClick={() => act(order, 'thanks')}>잘 먹었어요 ♥</button>}
          </div>
          {order.thanks && <p>♥ 잘 먹었어요!</p>}
        </article>)}
      </section>
      <button className="btn-quiet" disabled={busy} onClick={() => void run(refresh, '최신 상태를 확인했습니다.')}>새로고침</button>
    </>}
    {recovered.length > 0 && <section className="card stack"><h2>백업에서 복원한 식당 기록</h2>
      <p className="muted">이 기록은 보관용입니다. 현재 식당의 주문 상태는 바뀌지 않습니다.</p>
      {recovered.map(archive => <details key={archive.householdId}><summary>{archive.name} · 메뉴 {archive.menu.length}개 · 주문 {archive.orders.length}건</summary>
        {archive.menu.map(item => <div className="restaurant-row" key={item.id}><span>{item.recipe.title}</span>
          <button className="btn-quiet" disabled={busy} onClick={() => void run(() => recoverRecipe(item.recipe), '레시피 보관함에 새 사본을 만들었습니다.')}>레시피 사본 가져오기</button></div>)}
        {archive.orders.map(order => <article key={order.id}><h3>{order.date} {slotLabels[order.slot]} · {statusLabels[order.status]}</h3>
          <p>{order.items.map(item => item.title).join(' · ')} · {order.diners}인</p><p>{order.note}</p>
          {order.events.filter(event => event.comment).map((event, i) => <p key={i}>{event.comment}</p>)}
        </article>)}
      </details>)}
    </section>}
  </div>;
}
