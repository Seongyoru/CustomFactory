/**
 * =============================================================================
 *  전 라인 관제 뷰 — 라인 카드 그리드
 * =============================================================================
 *  공장 전체를 한 화면에서 훑는다: 어느 라인이 돌고, 어느 라인이 아픈가.
 *  카드를 클릭하면 그 라인의 3D 상세로 들어간다. 라인이 늘어도 카드만 늘어난다.
 *  데이터는 대시보드가 계산해 내려준다 (overviewData) — 여기는 표시만 한다.
 */
import React from 'react';
import {
  Activity, AlertOctagon, ArrowRight, Factory, Gauge, Layers, Siren, Wrench,
} from 'lucide-react';
import { CONSUMABLE_WARN_PCT } from '../../lib/maintenance.js';
import { fmtClock, fmtDate } from '../../lib/format.js';

/* 카드 상태 — 심각한 순서: 정지 > 알람 > 소모품 위험 > 유휴 > 가동 */
const cardStateOf = (d) => {
  if (d.eStop) return { key: 'estop', label: 'E-STOP', cls: 'text-red-500 border-red-500/50 bg-red-500/10', ring: 'ring-red-500/50' };
  if (d.alarms.length > 0) return { key: 'alarm', label: `알람 ${d.alarms.length}건`, cls: 'text-red-500 border-red-500/50 bg-red-500/10', ring: 'ring-red-500/40' };
  if (d.worstConsumable && d.worstConsumable.percent <= CONSUMABLE_WARN_PCT) {
    return { key: 'consumable', label: '소모품 위험', cls: 'text-amber-500 border-amber-500/50 bg-amber-500/10', ring: 'ring-amber-400/40' };
  }
  if (!d.head) return { key: 'idle', label: '유휴', cls: 'text-slate-400 border-slate-400/40 bg-slate-400/10', ring: '' };
  return { key: 'run', label: '가동 중', cls: 'text-emerald-500 border-emerald-500/50 bg-emerald-500/10', ring: '' };
};

const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

const Stat = ({ theme, label, value, warn = false }) => (
  <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-2.5 py-2 text-center`}>
    <p className={`text-[10px] ${theme.textFaint}`}>{label}</p>
    <p className={`mt-0.5 text-[14px] font-bold tabular-nums ${warn ? 'text-red-500' : theme.textPrimary}`}>
      {value}
    </p>
  </div>
);

const PlantOverview = ({ theme, data = [], now, onEnterLine }) => {
  const running = data.filter((d) => d.head && !d.eStop).length;
  const stopped = data.filter((d) => d.eStop).length;
  const alarmTotal = data.reduce((s, d) => s + d.alarms.length, 0);

  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[1100px] mx-auto p-6 space-y-5">
        {/* 헤더 — 공장 전체 요약 */}
        <header className="flex items-end justify-between gap-3">
          <div>
            <p className={`text-[10px] font-semibold tracking-widest ${theme.accentText}`}>PLANT OVERVIEW</p>
            <h2 className={`mt-1 text-xl font-bold ${theme.textPrimary}`}>전 라인 관제</h2>
          </div>
          <div className={`flex items-center gap-4 text-[11px] tabular-nums ${theme.textMuted}`}>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> 가동 {running}
            </span>
            <span className="flex items-center gap-1.5">
              <AlertOctagon className="w-3.5 h-3.5 text-red-500" /> 정지 {stopped}
            </span>
            <span className="flex items-center gap-1.5">
              <Siren className={`w-3.5 h-3.5 ${alarmTotal > 0 ? 'text-red-500' : ''}`} /> 알람 {alarmTotal}
            </span>
            <span>{fmtDate(now)} {fmtClock(now)}</span>
          </div>
        </header>

        {/* 라인 카드 그리드 */}
        <div className="grid grid-cols-2 gap-4">
          {data.map((d) => {
            const state = cardStateOf(d);
            const alert = state.key === 'estop' || state.key === 'alarm';
            return (
              <button
                key={d.lineId}
                type="button"
                onClick={() => onEnterLine?.(d.lineId)}
                title={`${d.name} 상세로 이동`}
                className={`text-left rounded-xl border ${theme.panelBorder} ${theme.panelBg} backdrop-blur-sm
                  p-4 space-y-3 transition hover:-translate-y-0.5 hover:shadow-xl
                  focus:outline-none focus:ring-2 ${theme.accentRing}
                  ${alert ? `ring-1 ${state.ring}` : ''}`}
              >
                {/* 라인명 + 상태 뱃지 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <Factory className={`w-4 h-4 shrink-0 ${theme.accentText}`} />
                    <span className={`text-[15px] font-bold truncate ${theme.textPrimary}`}>{d.name}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${state.cls} ${state.key === 'estop' ? 'animate-pulse' : ''}`}>
                      {state.label}
                    </span>
                    <ArrowRight className={`w-3.5 h-3.5 ${theme.textGhost}`} />
                  </span>
                </div>

                {/* 현재 로트 + 진행률 */}
                <div>
                  <div className={`flex items-baseline justify-between text-[11px] ${theme.textMuted}`}>
                    <span className="truncate">
                      {d.head ? `${d.head.name} (${d.head.id})` : '진행 중인 로트 없음'}
                    </span>
                    {d.head && (
                      <span className={`shrink-0 font-bold tabular-nums ${theme.textPrimary}`}>
                        {Math.round(d.progress)}%
                      </span>
                    )}
                  </div>
                  <div className={`mt-1.5 h-2 rounded-full overflow-hidden ${theme.trackBg}`}>
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${theme.barFrom} ${theme.barTo}`}
                      style={{ width: `${d.progress}%`, transition: 'width 900ms linear' }}
                    />
                  </div>
                  <div className={`mt-1 flex items-center justify-between text-[10px] tabular-nums ${theme.textFaint}`}>
                    <span>진행 {d.doneEa} EA{d.head ? ` / ${d.head.qty} EA` : ''}</span>
                    <span className="flex items-center gap-1">
                      <Layers className="w-3 h-3" /> 대기 {d.queueCount}건 · 잔여 {Math.max(0, d.remainQty)} EA
                    </span>
                  </div>
                </div>

                {/* 실린더 게이지 */}
                <div className="flex items-center gap-2">
                  <span className={`w-10 shrink-0 text-[10px] ${theme.textFaint}`}>실린더</span>
                  <span className="flex-1 flex gap-0.5">
                    {Array.from({ length: d.cylinder.capacity }).map((_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 flex-1 rounded-sm ${i < d.cylinder.fill ? '' : theme.trackBg}`}
                        style={i < d.cylinder.fill ? { backgroundColor: theme.accentHex } : undefined}
                      />
                    ))}
                  </span>
                  <span className={`shrink-0 text-[10px] tabular-nums ${theme.textGhost}`}>
                    {d.cylinder.active ? `${d.cylinder.fill}/${d.cylinder.capacity}` : '—'} · 반출 {d.cylinder.discharged}
                  </span>
                </div>

                {/* 지표 */}
                <div className="grid grid-cols-4 gap-1.5">
                  <Stat theme={theme} label="금일 생산" value={d.todayQty > 0 ? `${d.todayQty}` : '—'} />
                  <Stat theme={theme} label="OEE" value={pct(d.oee)} />
                  <Stat theme={theme} label="가동률" value={pct(d.availability)} />
                  <Stat
                    theme={theme}
                    label={d.worstConsumable ? d.worstConsumable.label : '소모품'}
                    value={d.worstConsumable ? `${d.worstConsumable.percent}%` : '—'}
                    warn={Boolean(d.worstConsumable && d.worstConsumable.percent <= CONSUMABLE_WARN_PCT)}
                  />
                </div>

                {/* 활성 알람 — 최근 2건만, 나머지는 알림 센터로 */}
                {d.alarms.length > 0 && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 space-y-1">
                    {[...d.alarms].reverse().slice(0, 2).map((a) => (
                      <p key={a.id} className="flex items-center gap-1.5 text-[10px] font-semibold text-red-500 truncate">
                        <Siren className="w-3 h-3 shrink-0" /> [{a.code}] {a.title}
                      </p>
                    ))}
                    {d.alarms.length > 2 && (
                      <p className={`text-[9px] ${theme.textFaint}`}>외 {d.alarms.length - 2}건 — 알림 센터에서 확인</p>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <p className={`flex items-center gap-1.5 text-[10px] ${theme.textGhost}`}>
          <Gauge className="w-3 h-3" /> 카드를 클릭하면 해당 라인의 3D 상세로 이동합니다 ·
          <Activity className="w-3 h-3" /> OEE = 가동률 × 성능 × 품질 ·
          <Wrench className="w-3 h-3" /> 소모품은 최저 잔량 항목 기준
        </p>
      </div>
    </div>
  );
};

export default PlantOverview;
