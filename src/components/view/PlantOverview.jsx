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
  Activity, AlertOctagon, ArrowRight, Clock, Factory, Gauge, Layers, Siren, Wrench,
} from 'lucide-react';
import { CONSUMABLE_WARN_PCT } from '../../lib/maintenance.js';
import { fmtClock, fmtDate } from '../../lib/format.js';
import { AnimatedNumber } from '../ui.jsx';

/** OEE 반원 게이지 — 값이 바뀌면 호가 부드럽게 따라온다 */
const MiniGauge = ({ theme, value }) => {
  const R = 15;
  const C = Math.PI * R; // 반원 둘레
  const p = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <svg viewBox="0 0 40 22" className="w-10 h-[22px] mx-auto" aria-hidden>
      <path d="M 5 20 A 15 15 0 0 1 35 20" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="4" strokeLinecap="round" />
      <path
        d="M 5 20 A 15 15 0 0 1 35 20"
        fill="none"
        stroke={theme.accentHex}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - p)}
        style={{ transition: 'stroke-dashoffset 700ms ease' }}
      />
    </svg>
  );
};

/** 시간대별 생산 스파크라인 — 최근 8시간, 숫자 대신 '흐름'을 보여준다 */
const Spark = ({ theme, values }) => {
  const max = Math.max(1, ...values);
  const W = 96;
  const H = 22;
  const gap = 2;
  const bw = (W - gap * (values.length - 1)) / values.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-24 h-[22px] shrink-0" aria-hidden>
      {values.map((v, i) => {
        const h = v === 0 ? 1.5 : Math.max(2.5, (v / max) * H);
        return (
          <rect
            key={i}
            x={i * (bw + gap)} y={H - h} width={bw} height={h} rx="1"
            fill={theme.accentHex}
            opacity={v === 0 ? 0.15 : 0.35 + 0.65 * (v / max)}
          />
        );
      })}
    </svg>
  );
};

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
  /* 공장 합계 — "오늘 공장이 어땠나"의 한 줄 답 */
  const todayTotal = data.reduce((s, d) => s + d.todayQty, 0);
  const oees = data.map((d) => d.oee).filter((v) => v != null);
  const avgOee = oees.length > 0 ? oees.reduce((a, b) => a + b, 0) / oees.length : null;
  const riskyTotal = data.reduce((s, d) => s + (d.riskyCount ?? 0), 0);

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
            <span>{fmtDate(now)} {fmtClock(now)}</span>
          </div>
        </header>

        {/* 공장 합계 밴드 */}
        <div className="grid grid-cols-4 gap-2">
          {[
            ['금일 총생산', todayTotal > 0 ? <><AnimatedNumber value={todayTotal} /> EA</> : '—', false],
            ['평균 OEE', pct(avgOee), false],
            ['활성 알람', `${alarmTotal}건`, alarmTotal > 0],
            ['소모품 위험 (≤15%)', `${riskyTotal}건`, riskyTotal > 0],
          ].map(([k, v, warn]) => (
            <div
              key={k}
              className={`rounded-lg border px-3 py-2.5
                ${warn ? 'border-red-500/40 bg-red-500/10' : `${theme.panelBorder} ${theme.subtleBg}`}`}
            >
              <p className={`text-[10px] ${warn ? 'text-red-500 font-semibold' : theme.textFaint}`}>{k}</p>
              <p className={`mt-1 text-[17px] font-bold tabular-nums ${warn ? 'text-red-500' : theme.textPrimary}`}>{v}</p>
            </div>
          ))}
        </div>

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
                        <AnimatedNumber value={d.progress} format={(v) => `${Math.round(v)}%`} />
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
                  {/* 완료 예정 — 관제의 첫 질문 "언제 끝나?" 의 답 */}
                  {d.head && (
                    <p className={`mt-1 flex items-center gap-1 text-[10px] tabular-nums
                      ${d.eStop ? 'text-red-500 font-semibold' : theme.textMuted}`}>
                      <Clock className="w-3 h-3 shrink-0" />
                      {d.eStop
                        ? 'E-STOP 정지 중 — 재가동 시 예정 시각 갱신'
                        : `현재 로트 완료 ~${fmtClock(d.finishHeadAt, false)}${
                            d.queueCount > 1 ? ` · 대기열 소진 ~${fmtClock(d.finishQueueAt, false)}` : ''
                          }`}
                    </p>
                  )}
                  {d.nextLots?.length > 0 && (
                    <p className={`mt-0.5 text-[10px] truncate ${theme.textGhost}`}>
                      다음 로트: {d.nextLots.map((j) => `${j.name} ${j.qty} EA`).join(' → ')}
                    </p>
                  )}
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

                {/* 생산 흐름 스파크라인 — 최근 8시간 */}
                <div className="flex items-center gap-2">
                  <span className={`w-10 shrink-0 text-[10px] ${theme.textFaint}`}>생산 8h</span>
                  <Spark theme={theme} values={d.spark ?? []} />
                  <span className={`flex-1 text-right text-[10px] tabular-nums ${theme.textGhost}`}>
                    합계 {(d.spark ?? []).reduce((a, b) => a + b, 0)} EA
                  </span>
                </div>

                {/* 지표 — OEE 는 반원 게이지로 */}
                <div className="grid grid-cols-4 gap-1.5">
                  <Stat
                    theme={theme}
                    label="금일 생산"
                    value={d.todayQty > 0 ? <AnimatedNumber value={d.todayQty} /> : '—'}
                  />
                  <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-2.5 py-2 text-center`}>
                    <p className={`text-[10px] ${theme.textFaint}`}>OEE</p>
                    <div className="relative mt-0.5">
                      <MiniGauge theme={theme} value={d.oee} />
                      <p className={`absolute inset-x-0 bottom-0 text-[10px] font-bold tabular-nums ${theme.textPrimary}`}>
                        {pct(d.oee)}
                      </p>
                    </div>
                  </div>
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
