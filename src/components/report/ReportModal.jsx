/**
 * =============================================================================
 *  리포트 센터 — 생산 실적 / 라인 OEE / 알람 이력 / 작업 로그
 * =============================================================================
 *  생산 엔진이 쌓은 실적(production)·이벤트(events)·라인 통계(lineStats)를
 *  관리자 관점으로 집계해 보여주고, 엑셀로 내보낸다.
 *
 *  OEE = 가동률(A) × 성능(P) × 품질(Q)
 *   A — 가동시간 / (가동시간 + 정지시간)          : E-STOP 등 비계획 정지의 영향
 *   P — Σ계획시간 / Σ실적시간 (완료 작업 기준)     : 사이클 편차의 영향
 *   Q — (생산량 − 불량) / 생산량                  : 불량의 영향
 * ---------------------------------------------------------------------------
 */
import React, { useMemo, useState } from 'react';
import {
  AlertOctagon, BarChart3, FileDown, ListChecks, ScrollText, Siren, Trash2, X,
} from 'lucide-react';
import { PRODUCTION_LINES } from '../../data/factoryAssets.js';
import { EVENT_TYPES, eventLabel } from '../../lib/events.js';
import { fmtClock, fmtDate, fmtDuration } from '../../lib/format.js';
import { downloadReportWorkbook } from '../../lib/reportExcel.js';
import { Modal } from '../ui.jsx';

const TONE_CHIP = {
  red: 'text-red-500 border-red-500/40 bg-red-500/10',
  amber: 'text-amber-500 border-amber-500/40 bg-amber-500/10',
  emerald: 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10',
  sky: 'text-sky-500 border-sky-500/40 bg-sky-500/10',
  slate: '',
};

const lineName = (id) => PRODUCTION_LINES.find((l) => l.id === id)?.name.replace('DM뷰 - ', '') ?? id ?? '-';
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

/** 이벤트 구분 칩 */
const EventChip = ({ theme, type }) => {
  const tone = EVENT_TYPES[type]?.tone ?? 'slate';
  const cls = TONE_CHIP[tone] || theme.chip;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${cls}`}>
      {eventLabel(type)}
    </span>
  );
};

/** 시간대별 생산량 막대 차트 (최근 12시간) */
const HourlyChart = ({ theme, production }) => {
  const buckets = useMemo(() => {
    const nowH = new Date();
    nowH.setMinutes(0, 0, 0);
    const list = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(nowH.getTime() - i * 3600_000);
      list.push({ start, label: `${String(start.getHours()).padStart(2, '0')}시`, qty: 0 });
    }
    production.forEach((p) => {
      const t = new Date(p.finishedAt).getTime();
      const idx = list.findIndex((b) => t >= b.start.getTime() && t < b.start.getTime() + 3600_000);
      if (idx >= 0) list[idx].qty += p.qty;
    });
    return list;
  }, [production]);

  const max = Math.max(1, ...buckets.map((b) => b.qty));
  const W = 480;
  const H = 120;
  const plotH = 92;
  const gap = 6;
  const barW = (W - gap * (buckets.length - 1)) / buckets.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="시간대별 생산량">
      {/* 눈금선 — 존재감 낮게 */}
      {[0.5, 1].map((f) => (
        <line
          key={f}
          x1="0" x2={W}
          y1={plotH - plotH * f} y2={plotH - plotH * f}
          stroke="currentColor" strokeWidth="0.5" opacity="0.12"
        />
      ))}
      <line x1="0" x2={W} y1={plotH} y2={plotH} stroke="currentColor" strokeWidth="0.7" opacity="0.25" />
      {buckets.map((b, i) => {
        const h = (b.qty / max) * plotH;
        const x = i * (barW + gap);
        const isMax = b.qty === max && b.qty > 0;
        return (
          <g key={i}>
            {b.qty > 0 && (
              <rect
                x={x} y={plotH - h} width={barW} height={h}
                rx="3"
                fill={theme.accentHex}
                opacity={isMax ? 1 : 0.75}
              >
                <title>{`${b.label} · ${b.qty} EA`}</title>
              </rect>
            )}
            {/* 최대 구간에만 직접 라벨 */}
            {isMax && (
              <text
                x={x + barW / 2} y={plotH - h - 5}
                textAnchor="middle" fontSize="10" fontWeight="700"
                fill="currentColor" opacity="0.85"
              >
                {b.qty}
              </text>
            )}
            <text
              x={x + barW / 2} y={H - 8}
              textAnchor="middle" fontSize="9"
              fill="currentColor" opacity={i % 2 === 0 ? 0.55 : 0}
            >
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/** OEE 지표 바 한 줄 */
const OeeBar = ({ theme, label, value, strong = false }) => (
  <div className="flex items-center gap-2">
    <span className={`w-12 shrink-0 text-[11px] ${strong ? `font-bold ${theme.textPrimary}` : theme.textMuted}`}>
      {label}
    </span>
    <span className={`flex-1 ${strong ? 'h-2.5' : 'h-1.5'} rounded-full overflow-hidden ${theme.trackBg}`}>
      <span
        className={`block h-full rounded-full bg-gradient-to-r ${theme.barFrom} ${theme.barTo}`}
        style={{ width: value == null ? 0 : `${Math.min(100, value * 100)}%`, transition: 'width 500ms ease' }}
      />
    </span>
    <span className={`w-11 text-right text-[11px] tabular-nums ${strong ? `font-bold ${theme.accentText}` : theme.textSecondary}`}>
      {pct(value)}
    </span>
  </div>
);

const ReportModal = ({
  theme, production, events, lineStats, onClose, onResetData,
  canExport = true, exportHint, canReset = true, resetHint,
}) => {
  const [tab, setTab] = useState('production');
  const [confirmReset, setConfirmReset] = useState(false);

  /* 라인별 OEE */
  const oeeByLine = useMemo(() => {
    const out = {};
    PRODUCTION_LINES.forEach((l) => {
      const s = lineStats[l.id] ?? {};
      const denomA = (s.runSec ?? 0) + (s.downSec ?? 0);
      const availability = denomA > 0 ? (s.runSec ?? 0) / denomA : null;
      const lineProd = production.filter((p) => p.lineId === l.id);
      const planned = lineProd.reduce((a, p) => a + (p.plannedSec ?? 0), 0);
      const actual = lineProd.reduce((a, p) => a + (p.actualSec ?? 0), 0);
      const performance = actual > 0 ? Math.min(1, planned / actual) : null;
      const quality = (s.produced ?? 0) > 0 ? (s.produced - (s.defects ?? 0)) / s.produced : null;
      const oee = availability != null && performance != null && quality != null
        ? availability * performance * quality
        : null;
      out[l.id] = { availability, performance, quality, oee };
    });
    return out;
  }, [lineStats, production]);

  /* 상단 KPI — 오늘 기준 */
  const kpis = useMemo(() => {
    const today = fmtDate(new Date());
    const todayProd = production.filter((p) => fmtDate(new Date(p.finishedAt)) === today);
    const qty = todayProd.reduce((a, p) => a + p.qty, 0);
    const defects = todayProd.reduce((a, p) => a + p.defects, 0);
    const planned = todayProd.reduce((a, p) => a + p.plannedSec, 0);
    const actual = todayProd.reduce((a, p) => a + p.actualSec, 0);
    const alarms = events.filter(
      (e) => e.type === 'ALARM_RAISED' && fmtDate(new Date(e.at)) === today
    ).length;
    return {
      qty,
      jobs: todayProd.length,
      defectRate: qty > 0 ? defects / qty : null,
      achieve: actual > 0 ? Math.min(1, planned / actual) : null,
      alarms,
    };
  }, [production, events]);

  const alarmEvents = events.filter((e) => e.type.startsWith('ALARM_') || e.type.startsWith('ESTOP_'));

  const tabs = [
    { key: 'production', label: '생산 리포트', icon: BarChart3 },
    { key: 'alarms', label: '알람 이력', icon: Siren, count: alarmEvents.length },
    { key: 'audit', label: '작업 로그', icon: ScrollText, count: events.length },
  ];

  const th = `px-3 py-2 text-left font-semibold whitespace-nowrap ${theme.textMuted}`;
  const td = `px-3 py-1.5 whitespace-nowrap`;

  return (
    <Modal theme={theme} onClose={onClose} className="w-[880px]">
      <header className={`flex items-center justify-between px-5 py-3.5 border-b ${theme.panelBorder} ${theme.accentBgSoft}`}>
        <div className="flex items-center gap-2">
          <BarChart3 className={`w-4 h-4 ${theme.accentText}`} />
          <h3 className={`text-sm font-bold ${theme.textPrimary}`}>리포트 센터</h3>
          <span className={`px-1.5 py-0.5 rounded text-[10px] border ${theme.chip}`}>
            {fmtDate(new Date())}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canExport}
            title={!canExport ? exportHint : undefined}
            onClick={() => downloadReportWorkbook({ production, events, lineStats, oeeByLine })}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-bold text-white ${theme.accentBg}
              hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            <FileDown className="w-3.5 h-3.5" /> 엑셀 내보내기
          </button>
          <button type="button" onClick={onClose} className={`grid place-items-center w-7 h-7 rounded-md ${theme.textMuted} ${theme.hoverBg}`} aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 탭 */}
      <nav className={`flex items-center gap-1 px-5 pt-3 border-b ${theme.divider}`}>
        {tabs.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-[12px] font-semibold border-b-2 transition-colors
              ${tab === key
                ? `${theme.accentText}`
                : `border-transparent ${theme.textMuted} ${theme.hoverBg}`}`}
            style={tab === key ? { borderColor: theme.accentHex } : undefined}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {count != null && <span className={`text-[10px] tabular-nums ${theme.textFaint}`}>{count}</span>}
          </button>
        ))}
      </nav>

      <div className="max-h-[62vh] overflow-y-auto p-5 space-y-5">
        {tab === 'production' && (
          <>
            {/* KPI 카드 */}
            <div className="grid grid-cols-5 gap-2">
              {[
                ['금일 생산량', kpis.qty > 0 ? `${kpis.qty} EA` : '—'],
                ['완료 작업', kpis.jobs > 0 ? `${kpis.jobs}건` : '—'],
                ['불량률', kpis.defectRate == null ? '—' : `${(kpis.defectRate * 100).toFixed(1)}%`],
                ['계획 달성률', pct(kpis.achieve)],
                ['금일 알람', `${kpis.alarms}건`],
              ].map(([k, v]) => (
                <div key={k} className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2.5`}>
                  <p className={`text-[10px] ${theme.textFaint}`}>{k}</p>
                  <p className={`mt-1 text-[17px] font-bold tabular-nums ${theme.textPrimary}`}>{v}</p>
                </div>
              ))}
            </div>

            {/* 라인별 OEE */}
            <section className="grid grid-cols-2 gap-3">
              {PRODUCTION_LINES.map((l) => {
                const o = oeeByLine[l.id];
                const s = lineStats[l.id] ?? {};
                return (
                  <div key={l.id} className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} p-3`}>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className={`text-[12px] font-bold ${theme.textPrimary}`}>{lineName(l.id)}</span>
                      <span className={`text-[10px] tabular-nums ${theme.textFaint}`}>
                        가동 {fmtDuration(s.runSec ?? 0)} · 정지 {fmtDuration(s.downSec ?? 0)} · {s.produced ?? 0} EA
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      <OeeBar theme={theme} label="가동률" value={o.availability} />
                      <OeeBar theme={theme} label="성능" value={o.performance} />
                      <OeeBar theme={theme} label="품질" value={o.quality} />
                      <div className={`pt-1.5 border-t ${theme.divider}`}>
                        <OeeBar theme={theme} label="OEE" value={o.oee} strong />
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>

            {/* 시간대별 생산량 */}
            <section className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} p-3 ${theme.textSecondary}`}>
              <p className={`text-[11px] font-bold mb-2 ${theme.textMuted}`}>시간대별 생산량 (최근 12시간)</p>
              <HourlyChart theme={theme} production={production} />
            </section>

            {/* 완료 작업 테이블 */}
            <section className={`rounded-lg border ${theme.panelBorder} overflow-hidden`}>
              <table className="w-full text-[11px]">
                <thead className={theme.headerBg}>
                  <tr className={`border-b ${theme.divider}`}>
                    {['완료 시각', '라인', '작업명', '수량', '불량', '계획', '실적', '달성률'].map((h) => (
                      <th key={h} className={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {production.length === 0 && (
                    <tr><td colSpan={8} className={`px-3 py-6 text-center ${theme.textFaint}`}>
                      아직 완료된 작업이 없습니다. 라인이 돌면 실적이 여기에 쌓입니다.
                    </td></tr>
                  )}
                  {production.slice(0, 50).map((p) => {
                    const d = new Date(p.finishedAt);
                    const achieve = p.actualSec > 0 ? p.plannedSec / p.actualSec : null;
                    return (
                      <tr key={p.id} className={`border-b last:border-0 ${theme.divider}`}>
                        <td className={`${td} tabular-nums ${theme.textFaint}`}>{fmtDate(d)} {fmtClock(d)}</td>
                        <td className={`${td} ${theme.textSecondary}`}>{lineName(p.lineId)}</td>
                        <td className={`${td} ${theme.textPrimary}`}>{p.name}</td>
                        <td className={`${td} tabular-nums ${theme.textSecondary}`}>{p.qty} EA</td>
                        <td className={`${td} tabular-nums ${p.defects > 0 ? 'text-red-500 font-semibold' : theme.textFaint}`}>
                          {p.defects > 0 ? `${p.defects} EA` : '0'}
                        </td>
                        <td className={`${td} tabular-nums ${theme.textFaint}`}>{fmtDuration(p.plannedSec)}</td>
                        <td className={`${td} tabular-nums ${theme.textSecondary}`}>{fmtDuration(p.actualSec)}</td>
                        <td className={`${td} tabular-nums font-semibold ${achieve != null && achieve < 0.9 ? 'text-amber-500' : theme.textSecondary}`}>
                          {achieve == null ? '—' : `${Math.round(achieve * 100)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </>
        )}

        {(tab === 'alarms' || tab === 'audit') && (
          <section className={`rounded-lg border ${theme.panelBorder} overflow-hidden`}>
            <table className="w-full text-[11px]">
              <thead className={theme.headerBg}>
                <tr className={`border-b ${theme.divider}`}>
                  {['시각', '구분', '라인', '내용'].map((h) => (
                    <th key={h} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(tab === 'alarms' ? alarmEvents : events).length === 0 && (
                  <tr><td colSpan={4} className={`px-3 py-6 text-center ${theme.textFaint}`}>
                    기록된 이벤트가 없습니다.
                  </td></tr>
                )}
                {(tab === 'alarms' ? alarmEvents : events).slice(0, 200).map((e) => {
                  const d = new Date(e.at);
                  return (
                    <tr key={e.id} className={`border-b last:border-0 ${theme.divider}`}>
                      <td className={`${td} tabular-nums ${theme.textFaint}`}>{fmtDate(d)} {fmtClock(d)}</td>
                      <td className={td}><EventChip theme={theme} type={e.type} /></td>
                      <td className={`${td} ${theme.textSecondary}`}>{lineName(e.lineId)}</td>
                      <td className={`px-3 py-1.5 ${theme.textSecondary}`}>{e.message}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>

      <footer className={`flex items-center justify-between px-5 py-3 border-t ${theme.panelBorder} ${theme.subtleBg}`}>
        {/* 데모 초기화 — 두 번 눌러야 실행된다 */}
        {!canReset ? (
          <span className={`inline-flex items-center gap-1.5 text-[11px] ${theme.textGhost}`} title={resetHint}>
            <Trash2 className="w-3.5 h-3.5" /> 데이터 초기화 (관리자 전용)
          </span>
        ) : confirmReset ? (
          <span className="flex items-center gap-2">
            <span className="text-[11px] text-red-500 font-semibold flex items-center gap-1">
              <AlertOctagon className="w-3.5 h-3.5" /> 모든 실적·이력·설정이 삭제됩니다.
            </span>
            <button
              type="button"
              onClick={onResetData}
              className="h-7 px-3 rounded-md bg-red-600 hover:bg-red-500 text-[11px] font-bold text-white"
            >
              초기화 실행
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className={`h-7 px-3 rounded-md border ${theme.panelBorder} text-[11px] ${theme.textSecondary} ${theme.hoverBg}`}
            >
              취소
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className={`inline-flex items-center gap-1.5 text-[11px] ${theme.textFaint} hover:text-red-500`}
          >
            <Trash2 className="w-3.5 h-3.5" /> 데모 데이터 초기화
          </button>
        )}
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1.5 text-[10px] ${theme.textFaint}`}>
            <ListChecks className="w-3.5 h-3.5" />
            실적 {production.length}건 · 이벤트 {events.length}건 보관 중
          </span>
          <button
            type="button"
            onClick={onClose}
            className={`h-9 px-4 rounded-lg border ${theme.panelBorder} text-[12px] font-semibold ${theme.textSecondary} ${theme.hoverBg}`}
          >
            닫기
          </button>
        </div>
      </footer>
    </Modal>
  );
};

export default ReportModal;
