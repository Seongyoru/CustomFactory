import { useEffect, useRef, useState } from 'react';
import { createSimulatedSource } from '../telemetry/simulatedSource.js';
import { createOpcUaSource } from '../telemetry/opcuaSource.js';

/** 스파크라인으로 보여줄 최근 표본 수 (1Hz × 120 = 2분) */
export const TELEMETRY_WINDOW = 120;

/** 버퍼 키(`라인.설비.항목`) 상한 — 매번 다른 id 를 보내는 게이트웨이가 메모리를 무한히 키우지 못하게 */
export const TELEMETRY_MAX_BUFFER_KEYS = 1024;

const SIM_INFO = { id: 'sim', label: '시뮬레이션 소스', protocol: 'SIM' };
const OPCUA_INFO = { id: 'opcua', label: 'OPC-UA 게이트웨이', protocol: 'OPC-UA' };

/**
 * 텔레메트리 소스를 앱에 연결한다 — 소스는 설정으로 갈아끼운다.
 *  sourceConfig:
 *   { type: 'sim' }                  — 내장 시뮬레이션 (기본)
 *   { type: 'opcua', url: 'wss://…' } — 사내망 WebSocket 게이트웨이 (opcuaSource 참조)
 *
 *  반환:
 *   latest      — { [lineId]: { [assetId]: { temp, vib, amp } } }
 *   seriesOf    — (lineId, assetId, key) => number[] 최근 표본
 *   sourceInfo  — { id, label, protocol }
 *   latencyMs   — 마지막 패킷의 지연
 *   status      — 'sim' | 'connecting' | 'connected' | 'reconnecting' | 'error'
 *
 *  게이트웨이의 알람 프레임은 onAlarm(alarm) 으로 올라온다
 *  (FAULT_SCENARIOS 형태 — 기존 알람 플로우가 그대로 동작).
 */
export function useTelemetry({ stoppedByLine, faults, sourceConfig, onAlarm }) {
  const ctxRef = useRef({ stoppedByLine, faults });
  ctxRef.current = { stoppedByLine, faults };
  const onAlarmRef = useRef(onAlarm);
  onAlarmRef.current = onAlarm;

  const buffersRef = useRef({}); // { `${lineId}.${assetId}.${key}`: number[] }
  const [latest, setLatest] = useState({});
  const [latencyMs, setLatencyMs] = useState(null);

  /* url 없는 opcua 설정(스토리지 손상·수동 편집)은 sim 으로 정규화 —
     라벨(sourceInfo)·상태·실제 기동 소스가 어떤 입력에서도 서로 어긋나지 않게 */
  const type = sourceConfig?.type === 'opcua' && (sourceConfig?.url ?? '').trim() ? 'opcua' : 'sim';
  const url = type === 'opcua' ? sourceConfig.url.trim() : '';

  /* status 는 어느 소스의 상태인지(src)와 함께 저장한다 — 소스 전환 커밋과
     effect 사이의 한 프레임 동안 이전 소스의 상태가 새 라벨에 붙어 보이지 않게 */
  const [statusState, setStatusState] = useState(() => ({
    src: type,
    value: type === 'opcua' ? 'connecting' : 'sim',
  }));
  const status =
    statusState.src === type ? statusState.value : type === 'opcua' ? 'connecting' : 'sim';

  useEffect(() => {
    /* 소스가 바뀌면 이전 소스의 흔적(그래프 버퍼·최신값)은 섞지 않고 비운다 */
    buffersRef.current = {};
    setLatest({});
    setLatencyMs(null);
    const putStatus = (s) => setStatusState({ src: type, value: s });

    let source;
    if (type === 'opcua') {
      putStatus('connecting');
      source = createOpcUaSource({
        url,
        onStatus: (s) => putStatus(s),
        onAlarm: (alarm) => onAlarmRef.current?.(alarm),
      });
    } else {
      putStatus('sim');
      source = createSimulatedSource({ getContext: () => ctxRef.current });
    }

    const unsubscribe = source.subscribe(({ readings, latencyMs: lat }) => {
      const buffers = buffersRef.current;
      Object.entries(readings).forEach(([lineId, byAsset]) => {
        Object.entries(byAsset).forEach(([assetId, metrics]) => {
          Object.entries(metrics).forEach(([key, value]) => {
            const bufKey = `${lineId}.${assetId}.${key}`;
            let buf = buffers[bufKey];
            if (!buf) {
              /* 상한 도달 시 새 키는 버린다 — 기존 키의 표본은 계속 갱신된다 */
              if (Object.keys(buffers).length >= TELEMETRY_MAX_BUFFER_KEYS) return;
              buf = buffers[bufKey] = [];
            }
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
  }, [type, url]);

  const seriesOf = (lineId, assetId, key) =>
    buffersRef.current[`${lineId}.${assetId}.${key}`] ?? [];

  return {
    latest,
    seriesOf,
    sourceInfo: type === 'opcua' ? OPCUA_INFO : SIM_INFO,
    latencyMs,
    status,
  };
}
