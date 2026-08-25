import { useEffect, useRef, useState } from 'react';
import { createSimulatedSource } from '../telemetry/simulatedSource.js';

/** 스파크라인으로 보여줄 최근 표본 수 (1Hz × 120 = 2분) */
export const TELEMETRY_WINDOW = 120;

/**
 * 텔레메트리 소스를 앱에 연결한다.
 *  - 소스는 1Hz 로 전체 설비 지표를 방출한다
 *  - 최근 2분 링버퍼를 유지한다 (설비 상세의 실시간 차트용)
 *  - 앱 상태(정지/오류)는 ref 로 넘겨서 소스 재생성 없이 항상 최신을 보게 한다
 *
 *  반환:
 *   latest      — { [lineId]: { [assetId]: { temp, vib, amp } } } (1Hz 갱신)
 *   seriesOf    — (lineId, assetId, key) => number[] 최근 표본
 *   sourceInfo  — { id, label, protocol }
 *   latencyMs   — 마지막 패킷의 지연
 */
export function useTelemetry({ stoppedByLine, faults }) {
  const ctxRef = useRef({ stoppedByLine, faults });
  ctxRef.current = { stoppedByLine, faults };

  const sourceRef = useRef(null);
  if (sourceRef.current === null) {
    sourceRef.current = createSimulatedSource({ getContext: () => ctxRef.current });
  }

  const buffersRef = useRef({}); // { `${lineId}.${assetId}.${key}`: number[] }
  const [latest, setLatest] = useState({});
  const [latencyMs, setLatencyMs] = useState(null);

  useEffect(() => {
    const source = sourceRef.current;
    const unsubscribe = source.subscribe(({ readings, latencyMs: lat }) => {
      const buffers = buffersRef.current;
      Object.entries(readings).forEach(([lineId, byAsset]) => {
        Object.entries(byAsset).forEach(([assetId, metrics]) => {
          Object.entries(metrics).forEach(([key, value]) => {
            const bufKey = `${lineId}.${assetId}.${key}`;
            const buf = buffers[bufKey] ?? (buffers[bufKey] = []);
            buf.push(value);
            if (buf.length > TELEMETRY_WINDOW) buf.shift();
          });
        });
      });
      setLatest(readings);
      setLatencyMs(lat);
    });
    source.start();
    return () => {
      unsubscribe();
      source.stop();
    };
  }, []);

  const seriesOf = (lineId, assetId, key) =>
    buffersRef.current[`${lineId}.${assetId}.${key}`] ?? [];

  return { latest, seriesOf, sourceInfo: sourceRef.current.info, latencyMs };
}
