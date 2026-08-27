/**
 * =============================================================================
 *  알림 센터 — GNB 종 아이콘 + 활성 알람 드롭다운
 * =============================================================================
 *  다중 알람 큐의 소비 창구. 팝업(FaultAlarmModal)이 "지금 막 발생한 미확인
 *  1건"을 강제로 들이민다면, 여기는 활성 알람 전체를 훑고 건별로 이동·해제하는
 *  관제 화면이다. 해제는 오류 테스트와 같은 권한(fault.test, 운영자↑)을 쓴다.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Bell, Crosshair, X } from 'lucide-react';
import { PRODUCTION_LINES, findAsset } from '../../data/factoryAssets.js';
import { fmtClock } from '../../lib/format.js';

const lineNameOf = (id) => PRODUCTION_LINES.find((l) => l.id === id)?.name ?? id;

const AlarmCenter = ({ theme, alarms = [], onGoTo, onClear, canClear = true, clearHint }) => {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  /* 새 미확인 알람이 오면 종이 0.6초 흔들린다 */
  const [ringing, setRinging] = useState(false);
  const prevUnackedRef = useRef(0);
  const unackedNow = alarms.filter((a) => !a.acked).length;
  useEffect(() => {
    if (unackedNow > prevUnackedRef.current) {
      setRinging(true);
      const t = setTimeout(() => setRinging(false), 650);
      prevUnackedRef.current = unackedNow;
      return () => clearTimeout(t);
    }
    prevUnackedRef.current = unackedNow;
    return undefined;
  }, [unackedNow]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const unacked = alarms.filter((a) => !a.acked).length;
  /* 최신이 위로 — 방금 발생한 것부터 훑는다 */
  const list = [...alarms].reverse();

  return (
    <div className="relative" ref={boxRef} data-tour="alarm-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={alarms.length > 0 ? `활성 알람 ${alarms.length}건` : '활성 알람 없음'}
        aria-label="알림 센터"
        className={`relative grid place-items-center w-9 h-9 rounded-lg border transition-colors
          focus:outline-none focus:ring-2 ${theme.accentRing}
          ${alarms.length > 0
            ? 'border-red-500/50 bg-red-500/10 text-red-500 hover:bg-red-500/20'
            : `${theme.panelBorder} ${theme.subtleBg} ${theme.textSecondary} ${theme.hoverBg}`}`}
      >
        <Bell className={`w-4 h-4 ${ringing ? 'anim-bell' : ''}`} />
        {alarms.length > 0 && (
          <span
            className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 grid place-items-center
              rounded-full text-[10px] font-bold text-white bg-red-600
              ${unacked > 0 ? 'animate-pulse' : ''}`}
          >
            {alarms.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`anim-drop absolute right-0 top-full mt-1.5 w-[340px] rounded-lg border ${theme.panelBorder}
            ${theme.headerBg} shadow-2xl overflow-hidden z-50`}
        >
          <div className={`flex items-center justify-between px-3 py-2.5 border-b ${theme.divider}`}>
            <span className={`text-[12px] font-bold ${theme.textPrimary}`}>알림 센터</span>
            <span className={`text-[10px] tabular-nums ${theme.textFaint}`}>
              활성 {alarms.length}건 · 미확인 {unacked}건
            </span>
          </div>

          {alarms.length === 0 ? (
            <p className={`px-3 py-6 text-center text-[11px] ${theme.textFaint}`}>
              활성 알람이 없습니다. 설비 오류·소모품 위험이 발생하면 여기에 쌓입니다.
            </p>
          ) : (
            <ol className="max-h-[320px] overflow-y-auto">
              {list.map((a) => (
                <li key={a.id} className={`px-3 py-2.5 border-b last:border-0 ${theme.divider}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5">
                        <span className={`text-[11px] font-bold ${a.acked ? theme.textSecondary : 'text-red-500'}`}>
                          [{a.code}] {a.title}
                        </span>
                        {(a.count ?? 1) > 1 && (
                          <span className={`shrink-0 px-1 py-px rounded text-[9px] font-bold border ${theme.chip}`}
                            title="이 설비에서 오류가 갱신·재발생한 횟수">
                            ×{a.count}
                          </span>
                        )}
                        {!a.acked && (
                          <span className="shrink-0 px-1 py-px rounded text-[9px] font-bold text-white bg-red-600">
                            NEW
                          </span>
                        )}
                      </p>
                      <p className={`mt-0.5 text-[10px] tabular-nums ${theme.textFaint}`}>
                        {lineNameOf(a.lineId)} · {findAsset(a.assetId)?.nameKo ?? a.assetId} · {fmtClock(a.at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title={a.acked ? '해당 설비로 이동' : '해당 설비로 이동 (확인 처리)'}
                        aria-label="설비로 이동"
                        onClick={() => { setOpen(false); onGoTo?.(a.id); }}
                        className={`grid place-items-center w-6 h-6 rounded-md ${theme.textMuted} ${theme.hoverBg}`}
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={!canClear}
                        title={canClear ? '알람 해제 (조치 완료)' : clearHint}
                        aria-label="알람 해제"
                        onClick={() => onClear?.(a.id)}
                        className={`grid place-items-center w-6 h-6 rounded-md transition-colors
                          ${theme.textGhost} hover:text-red-500 ${theme.hoverBg}
                          disabled:opacity-30 disabled:cursor-not-allowed`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
};

export default AlarmCenter;
