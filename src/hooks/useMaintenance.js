/**
 * =============================================================================
 *  설비 보전 훅 — 소모품 라이브 소모 + 교체 이력
 * =============================================================================
 *  대시보드가 계산한 라인별 누적 처리 EA(totalEaKey)를 받아, 증가분만큼
 *  그 라인 설비들의 소모품을 깎는다 (마모 로직은 lib/maintenance.js).
 *
 *  마커(consumableEaMarker)는 "여기까지의 EA 는 이미 반영했다"는 기준점이다.
 *   - 최초 실행(마커 없음)에는 현재 누적치를 기준점으로 삼기만 한다 — 과거
 *     생산분에 소급 마모를 걸면 접속하자마자 소모품이 왕창 닳는다.
 *   - 선두 로트 취소 등으로 누적치가 줄면 기준점만 내려 맞춘다 (마모 되돌림 없음).
 *   - StrictMode: 효과 본문이 이중 실행돼도 ref 마커가 즉시 갱신되므로
 *     두 번째 실행의 증가분은 0 이다 (부수효과는 setState 업데이터 밖에서).
 * ---------------------------------------------------------------------------
 */
import { useCallback, useEffect, useRef } from 'react';
import { lineSelectableAssets } from '../data/lineAssets.js';
import { applyWear, consumableKeyOf } from '../lib/maintenance.js';
import { readStore, usePersistentState, writeStore } from '../lib/persist.js';

const MAINT_LOG_LIMIT = 200;

/**
 * @param totalEaKey  "L1:123,L2:45" — 라인별 누적 처리 EA (produced + 진행 중 로트의 완료분)
 * @param onCrossing  (lineId, crossing:{kind:'warn'|'crit', assetId, percent}) — 임계 하향 통과 보고
 */
export function useMaintenance({ totalEaKey, onCrossing }) {
  const [percents, setPercents] = usePersistentState('consumables', {});
  const [maintLog, setMaintLog] = usePersistentState('maintLog', []);

  /* 잔량의 최신값 미러 — 마모 계산은 여기서 하고 state 는 결과만 받는다 */
  const percentsRef = useRef(percents);
  percentsRef.current = percents;
  const onCrossingRef = useRef(onCrossing);
  onCrossingRef.current = onCrossing;
  const markerRef = useRef(null);
  if (markerRef.current === null) {
    markerRef.current = readStore('consumableEaMarker', {});
  }

  useEffect(() => {
    const marker = markerRef.current;
    let markerDirty = false;
    for (const part of totalEaKey.split(',')) {
      const [lineId, totalStr] = part.split(':');
      const total = Number(totalStr) || 0;
      const prev = marker[lineId];
      if (typeof prev !== 'number' || total < prev) {
        /* 최초 접속(소급 마모 금지) 또는 로트 취소로 후퇴 — 기준점만 동기화 */
        if (prev !== total) {
          marker[lineId] = total;
          markerDirty = true;
        }
        continue;
      }
      const delta = total - prev;
      if (delta === 0) continue;
      marker[lineId] = total;
      markerDirty = true;
      const { next, crossings } = applyWear(
        percentsRef.current,
        lineId,
        delta,
        lineSelectableAssets(lineId)
      );
      if (next !== percentsRef.current) {
        percentsRef.current = next;
        setPercents(next);
      }
      crossings.forEach((c) => onCrossingRef.current?.(lineId, c));
    }
    if (markerDirty) writeStore('consumableEaMarker', marker);
  }, [totalEaKey, setPercents]);

  /** 소모품 교체 — 잔량 100% 리셋 + 교체 이력 기록. 기록한 이력을 돌려준다. */
  const replaceConsumable = useCallback(
    (lineId, asset, user) => {
      const key = consumableKeyOf(lineId, asset.id);
      const before =
        typeof percentsRef.current[key] === 'number'
          ? percentsRef.current[key]
          : asset.consumable?.percent ?? 0;
      const next = { ...percentsRef.current, [key]: 100 };
      percentsRef.current = next;
      setPercents(next);
      const record = {
        id: `MT-${Date.now()}-${asset.id}`,
        at: new Date().toISOString(),
        lineId,
        assetId: asset.id,
        name: asset.nameKo ?? asset.name ?? asset.id,
        label: asset.consumable?.label ?? '소모품',
        percentBefore: before,
        user: user ?? '-',
      };
      setMaintLog((prev) => [record, ...prev].slice(0, MAINT_LOG_LIMIT));
      return record;
    },
    [setPercents, setMaintLog]
  );

  return { consumablePercents: percents, maintLog, replaceConsumable };
}
