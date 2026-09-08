import { useEffect, useState } from 'react';
import { cachedSnapshot, configured, refresh } from './client';
import type { Snapshot } from './contracts';

export function useHousehold() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(configured);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const read = async () => {
      try { const data = await cachedSnapshot(); if (active) setSnapshot(data); }
      catch { if (active) setError('저장된 공유 데이터를 읽지 못했습니다. 다시 연결해주세요.'); }
    };
    const sync = async () => {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try { const data = await refresh(); if (active) { setSnapshot(data); setError(''); } }
      catch (e) { if (active) setError(e instanceof Error ? e.message : '연결을 확인해주세요.'); }
      finally { inFlight = false; if (active) setLoading(false); }
    };
    void read();
    if (configured) void sync();
    const timer = configured ? window.setInterval(() => void sync(), 15000) : undefined;
    const visible = () => { if (configured) void sync(); };
    window.addEventListener('household-updated', read);
    window.addEventListener('online', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false; window.clearInterval(timer);
      window.removeEventListener('household-updated', read);
      window.removeEventListener('online', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return { snapshot, error, loading };
}
