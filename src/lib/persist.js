/**
 * =============================================================================
 *  로컬 영속화 계층 — localStorage 기반
 * =============================================================================
 *  새로고침해도 작업 대기열·배치 조정·메모·이력이 유지되게 한다.
 *
 *  - 키는 `egis-dt.v1.<이름>` 네임스페이스를 쓴다. 스키마가 바뀌면 버전을 올려
 *    구버전 데이터와 충돌 없이 초기화되게 한다.
 *  - localStorage 는 예외를 던질 수 있다(시크릿 모드 용량 제한, 접근 차단 등).
 *    저장 실패로 앱이 죽으면 안 되므로 전부 try/catch 로 감싼다.
 *  - 실서버 연동 시 이 파일만 REST/WebSocket 저장소로 교체하면 된다.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useRef, useState } from 'react';

const NS = 'egis-dt';
/* v3: 표준시간이 택트×수량 → 애니메이션 유도(도입·마무리 포함)로 바뀌고
   실린더 용량이 4회 완충으로 확정됨. v2 로트의 totalSec 은 새 의미와 어긋난다. */
const VERSION = 'v3';
const keyOf = (key) => `${NS}.${VERSION}.${key}`;

/* ---------------------------------------------------------------------------
 * 원격 저장소 — gateway/persist-server.js (참조 구현)와 짝
 * ---------------------------------------------------------------------------
 *  동기 usePersistentState 구조를 바꾸지 않는 최소 설계:
 *   - 부팅: main.jsx 가 hydrateFromRemote() 로 서버 스냅샷을 localStorage 에
 *     선주입한 뒤에야 앱을 마운트한다 → 화면 코드는 여전히 동기 로컬만 본다
 *   - 저장: writeStore/removeStore 가 로컬에 쓰고 서버에도 써 둔다
 *     (키별 500ms 디바운스, 실패는 무시 — 서버가 죽어도 화면은 로컬로 계속 동작)
 *  연결 URL 은 버전 네임스페이스 밖에 둔다 — 데모 초기화가 데이터는 지워도
 *  연결은 유지해, 리로드 후 '빈 서버 + 빈 로컬'로 깨끗하게 다시 시작하게.
 * ------------------------------------------------------------------------- */
const REMOTE_URL_KEY = `${NS}.remoteStore`;

export const getRemoteStoreUrl = () => {
  try {
    return localStorage.getItem(REMOTE_URL_KEY) ?? '';
  } catch {
    return '';
  }
};

export const setRemoteStoreUrl = (url) => {
  try {
    if (url) localStorage.setItem(REMOTE_URL_KEY, url);
    else localStorage.removeItem(REMOTE_URL_KEY);
  } catch { /* ignore */ }
};

const remoteBase = () => getRemoteStoreUrl().replace(/\/+$/, '');
const remoteKeyUrl = (fullKey) => `${remoteBase()}/store/${encodeURIComponent(fullKey)}`;

/* 키별 디바운스 큐 — 매초 갱신되는 키(경과시간 등)가 서버를 두들기지 않게 */
const pendingPush = new Map();
const schedulePush = (fullKey, serialized) => {
  if (!getRemoteStoreUrl()) return;
  clearTimeout(pendingPush.get(fullKey));
  pendingPush.set(
    fullKey,
    setTimeout(() => {
      pendingPush.delete(fullKey);
      fetch(remoteKeyUrl(fullKey), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: serialized,
      }).catch(() => { /* 오프라인 — 로컬로 계속 */ });
    }, 500)
  );
};

const remoteDelete = (fullKey) => {
  if (!getRemoteStoreUrl()) return;
  clearTimeout(pendingPush.get(fullKey));
  pendingPush.delete(fullKey);
  fetch(remoteKeyUrl(fullKey), { method: 'DELETE' }).catch(() => { /* ignore */ });
};

/** 부팅 선주입 — 앱 마운트 전에 1회. 서버가 없거나 죽었으면 로컬로 진행한다. */
export async function hydrateFromRemote({ timeoutMs = 3000 } = {}) {
  const base = remoteBase();
  if (!base) return { mode: 'local' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${base}/store`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snap = await res.json();
    let count = 0;
    for (const [k, v] of Object.entries(snap.keys ?? {})) {
      if (!k.startsWith(`${NS}.`) || k === REMOTE_URL_KEY) continue; // 우리 키만
      try {
        localStorage.setItem(k, JSON.stringify(v));
        count += 1;
      } catch { /* 용량 초과 등 — 해당 키만 포기 */ }
    }
    return { mode: 'remote', count, rev: snap.rev ?? 0 };
  } catch (e) {
    return { mode: 'offline', error: String(e?.message ?? e) };
  }
}

/** 연결 직후 1회 — 지금 로컬에 있는 앱 키 전부를 서버로 올린다 */
export function pushAllToRemote() {
  const base = remoteBase();
  if (!base) return;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(`${NS}.`) || k === REMOTE_URL_KEY) continue;
      const raw = localStorage.getItem(k);
      if (raw != null) schedulePush(k, raw);
    }
  } catch { /* ignore */ }
}

export function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(keyOf(key));
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeStore(key, value) {
  try {
    const serialized = JSON.stringify(value);
    localStorage.setItem(keyOf(key), serialized);
    schedulePush(keyOf(key), serialized); // 원격 미설정이면 즉시 무시된다
  } catch {
    /* 저장 실패는 무시 — 메모리 상태로는 계속 동작한다 */
  }
}

export function removeStore(key) {
  try {
    localStorage.removeItem(keyOf(key));
    remoteDelete(keyOf(key));
  } catch { /* ignore */ }
}

/** 이 앱이 저장한 모든 키를 지운다 (데모 초기화용).
 *  원격 저장소가 연결돼 있으면 서버도 함께 비운다 — 안 지우면 리로드 때
 *  부팅 선주입이 지운 데이터를 도로 살려낸다. 연결 URL 자체는 남긴다. */
export function clearAllPersisted() {
  try {
    const base = remoteBase();
    if (base) {
      pendingPush.forEach((t) => clearTimeout(t));
      pendingPush.clear();
      fetch(`${base}/store`, { method: 'DELETE' }).catch(() => { /* ignore */ });
    }
    const prefix = `${NS}.`;
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && k !== REMOTE_URL_KEY) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

/**
 * localStorage 와 동기화되는 useState.
 *  - 최초 마운트에 저장값이 있으면 그걸로 시작한다 (revive 로 Date 등 복원 가능)
 *  - 값이 바뀔 때마다 저장한다
 */
export function usePersistentState(key, initial, revive) {
  const [value, setValue] = useState(() => {
    const stored = readStore(key, undefined);
    if (stored === undefined) return typeof initial === 'function' ? initial() : initial;
    return revive ? revive(stored) : stored;
  });

  const firstRun = useRef(true);
  useEffect(() => {
    /* 초기값 그대로면 굳이 쓰지 않는다 — 저장은 첫 변경부터 */
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    writeStore(key, value);
  }, [key, value]);

  return [value, setValue];
}
