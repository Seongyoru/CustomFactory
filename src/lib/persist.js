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
const VERSION = 'v1';
const keyOf = (key) => `${NS}.${VERSION}.${key}`;

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
    localStorage.setItem(keyOf(key), JSON.stringify(value));
  } catch {
    /* 저장 실패는 무시 — 메모리 상태로는 계속 동작한다 */
  }
}

export function removeStore(key) {
  try {
    localStorage.removeItem(keyOf(key));
  } catch { /* ignore */ }
}

/** 이 앱이 저장한 모든 키를 지운다 (데모 초기화용) */
export function clearAllPersisted() {
  try {
    const prefix = `${NS}.`;
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
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
