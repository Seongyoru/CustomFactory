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
  Activity, AlertOctagon, BarChart3, FileDown, ListChecks, Printer, ScrollText, Siren, Trash2, Wrench, X,
} from 'lucide-react';
import { PRODUCTION_LINES, findAsset } from '../../data/factoryAssets.js';
import { lineSelectableAssets } from '../../data/lineAssets.js';
import {
  CONSUMABLE_WARN_PCT, consumablePercentOf, daysUntil, maintenanceKpis, remainingEaOf,
} from '../../lib/maintenance.js';
import PrintReport from './PrintReport.jsx';
import { defectPareto, defectRateSeries } from '../../lib/quality.js';
import { EVENT_TYPES, eventLabel } from '../../lib/events.js';
import { fmtClock, fmtDate, fmtDuration, fmtKoDuration, fmtSpeed } from '../../lib/format.js';
import { downloadReportWorkbook } from '../../lib/reportExcel.js';
import { Modal } from '../ui.jsx';

const TONE_CHIP = {
  red: 'text-red-500 border-red-500/40 bg-red-500/10',
  amber: 'text-amber-500 border-amber-500/40 bg-amber-500/10',
  emerald: 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10',
  sky: 'text-sky-500 border-sky-500/40 bg-sky-500/10',
  slate: '',
};

const lineName = (id) => PRODUCTION_LINES.find((l) => l.id === id)?.name ?? id ?? '-';
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

/**
 * 품질 파레토 — 불량 유형 빈도 막대(내림차순) + 누적 점유율 꺾은선.
 *  "어떤 불량부터 잡아야 하는가"에 답하는 차트다.
 */
const ParetoChart = ({ theme, pareto }) => {
  const { rows } = pareto;
  const W = 480;
  const H = 150;
  const plotH = 104;
  const gap = 18;
  const barW = (W - gap * (rows.length + 1)) / rows.length;
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const xOf = (i) => gap + i * (barW + gap);
  const yOfCum = (cum) => plotH - cum * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="불량 유형 파레토">
      {[0.5, 1].map((f) => (
        <line key={f} x1="0" x2={W} y1={plotH - plotH * f} y2={plotH - plotH * f}
          stroke="currentColor" strokeWidth="0.5" opacity="0.12" />
      ))}
      <line x1="0" x2={W} y1={plotH} y2={plotH} stroke="currentColor" strokeWidth="0.7" opacity="0.25" />

      {/* 빈도 막대 */}
      {rows.map((r, i) => {
        const h = (r.count / maxCount) * (plotH - 18);
        return (
          <g key={r.type}>
            <rect x={xOf(i)} y={plotH - h} width={barW} height={h} rx="3"
              fill={theme.accentHex} opacity={r.type === '유형 미기록' ? 0.3 : 0.8}>
              <title>{`${r.type} · ${r.count}건 (${Math.round(r.share * 100)}%)`}</title>
            </rect>
            <text x={xOf(i) + barW / 2} y={plotH - h - 4} textAnchor="middle" fontSize="10"
              fontWeight="700" fill="currentColor" opacity="0.85">
              {r.count}
            </text>
            <text x={xOf(i) + barW / 2} y={H - 22} textAnchor="middle" fontSize="9"
              fill="currentColor" opacity="0.6">
              {r.type}
            </text>
            <text x={xOf(i) + barW / 2} y={H - 10} textAnchor="middle" fontSize="8"
              fill="currentColor" opacity="0.4">
              {Math.round(r.share * 100)}%
            </text>
          </g>
        );
      })}

      {/* 누적 점유율 꺾은선 — 80% 기준선과 함께 */}
      <line x1="0" x2={W} y1={yOfCum(0.8)} y2={yOfCum(0.8)}
        stroke="#ef4444" strokeWidth="0.6" strokeDasharray="4 3" opacity="0.5" />
      <polyline
        points={rows.map((r, i) => `${xOf(i) + barW / 2},${yOfCum(r.cum)}`).join(' ')}
        fill="none" stroke="#f59e0b" strokeWidth="1.6" opacity="0.9"
      />
      {rows.map((r, i) => (
        <g key={`c-${r.type}`}>
          <circle cx={xOf(i) + barW / 2} cy={yOfCum(r.cum)} r="2.4" fill="#f59e0b" />
          <text x={xOf(i) + barW / 2 + 6} y={yOfCum(r.cum) - 4} fontSize="8.5"
            fontWeight="700" fill="#f59e0b">
            {Math.round(r.cum * 100)}%
          </text>
        </g>
      ))}
    </svg>
  );
};

/**
 * 불량률 관리도(p-차트 근사) — 로트별 불량률 런차트 + 평균선 + 관리상한(UCL).
 *  파레토가 "어떤 불량이 많은가"라면, 이 차트는 "언제부터 공정이 흔들렸나"에 답한다.
 *  UCL 을 넘는 점은 적색으로 강조된다.
 */
const SpcChart = ({ theme, spc }) => {
  const { rows, mean, ucl } = spc;
  const W = 480;
  const H = 120;
  const plotH = 96;
  const yMax = Math.max(ucl, ...rows.map((r) => r.rate)) * 1.25 || 0.01;
  const yOf = (v) => plotH - (v / yMax) * plotH;
  const xOf = (i) => (rows.length > 1 ? 12 + (i * (W - 24)) / (rows.length - 1) : W / 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="불량률 관리도">
      <line x1="0" x2={W} y1={plotH} y2={plotH} stroke="currentColor" strokeWidth="0.7" opacity="0.25" />
      {/* 평균선 · 관리상한 */}
      <line x1="0" x2={W} y1={yOf(mean)} y2={yOf(mean)} stroke={theme.accentHex} strokeWidth="0.8" opacity="0.5" />
      <text x={W - 4} y={yOf(mean) - 3} textAnchor="end" fontSize="8" fill={theme.accentHex} opacity="0.8">
        평균 {(mean * 100).toFixed(2)}%
      </text>
      {ucl > 0 && (
        <>
          <line x1="0" x2={W} y1={yOf(ucl)} y2={yOf(ucl)} stroke="#ef4444" strokeWidth="0.8" strokeDasharray="4 3" opacity="0.7" />
          <text x={W - 4} y={yOf(ucl) - 3} textAnchor="end" fontSize="8" fill="#ef4444" opacity="0.9">
            UCL {(ucl * 100).toFixed(2)}%
          </text>
        </>
      )}
      {/* 런 라인 + 점 */}
      <polyline
        points={rows.map((r, i) => `${xOf(i)},${yOf(r.rate)}`).join(' ')}
        fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.45"
      />
      {rows.map((r, i) => {
        const over = ucl > 0 && r.rate > ucl;
        return (
          <circle key={`${r.id}-${i}`} cx={xOf(i)} cy={yOf(r.rate)} r={over ? 3 : 2.2}
            fill={over ? '#ef4444' : theme.accentHex}>
            <title>{`${r.id} (${lineName(r.lineId)}) · ${r.qty} EA · 불량률 ${(r.rate * 100).toFixed(2)}%${over ? ' — 관리상한 초과' : ''}`}</title>
          </circle>
        );
      })}
      <text x="4" y={H - 6} fontSize="8" fill="currentColor" opacity="0.4">← 과거</text>
      <text x={W - 4} y={H - 6} textAnchor="end" fontSize="8" fill="currentColor" opacity="0.4">최근 →</text>
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
  simSnapshots = [], onDeleteSnapshot, canManageSnapshots = true,
  consumablePercents = {}, maintLog = [],
  dailyTargetByLine = {}, kwhByLine = {}, handoverNotes = [],
  /* canReset 은 닫힌 기본값 — 초기화는 원격 저장소까지 지우는 파괴적 동작이라
     prop 오배선 시 열리는 쪽(fail-open)이어서는 안 된다 */
  canExport = true, exportHint, canReset = false, resetHint,
}) => {
  const [tab, setTab] = useState('production');
  const [confirmReset, setConfirmReset] = useState(false);
  /* 스냅샷 비교 — 최대 2개 선택. 삭제·캡 축출로 죽은 id 는 선택에서 걸러낸다 —
     고아 id 가 마지막 슬롯을 차지해 살아있는 선택을 밀어내지 않게 */
  const [compareIds, setCompareIds] = useState([]);
  const toggleCompare = (id) =>
    setCompareIds((prev) => {
      const live = prev.filter((x) => simSnapshots.some((s) => s.id === x));
      return live.includes(id) ? live.filter((x) => x !== id) : [...live.slice(-1), id];
    });
  const compared = compareIds
    .map((id) => simSnapshots.find((s) => s.id === id))
    .filter(Boolean);
  /* 스냅샷 삭제는 되돌릴 수 없다 — 첫 클릭은 무장, 두 번째 클릭이 실제 삭제 */
  const [armedDelete, setArmedDelete] = useState(null);

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

  /* 설비 보전 현황 — 전 라인 × 소모품 보유 설비. 잔량은 라이브 값, 점검일은 D-day 로 */
  const maintRows = useMemo(
    () =>
      PRODUCTION_LINES.flatMap((l) =>
        lineSelectableAssets(l.id)
          .filter((a) => a.consumable)
          .map((a) => {
            const percent = Math.max(0, Math.round(consumablePercentOf(consumablePercents, l.id, a.id) ?? 0));
            return {
              lineId: l.id,
              assetId: a.id,
              name: a.nameKo,
              sn: a.sn,
              label: a.consumable.label,
              percent,
              remainEa: remainingEaOf(percent, a.id),
              nextCheck: a.nextCheck,
              dDay: daysUntil(a.nextCheck),
            };
          })
      ),
    [consumablePercents]
  );
  const riskyConsumables = maintRows.filter((r) => r.percent <= CONSUMABLE_WARN_PCT);
  const dueChecks = maintRows.filter((r) => r.dDay != null && r.dDay <= 14);

  /* 보전 지표 — 알람 발생·확인·해제 이벤트에서 산출 (이벤트 로그 보관분 기준) */
  const maintKpis = useMemo(() => maintenanceKpis(events), [events]);

  /* 품질 파레토 — 누적 실적의 불량 유형 분포 */
  const pareto = useMemo(() => defectPareto(production), [production]);
  /* 불량률 관리도 — 최근 30로트의 p-차트 근사 */
  const spc = useMemo(() => defectRateSeries(production, 30), [production]);

  const tabs = [
    { key: 'production', label: '생산 리포트', icon: BarChart3 },
    { key: 'maintenance', label: '설비 보전', icon: Wrench, count: riskyConsumables.length + dueChecks.length },
    { key: 'simulations', label: '시뮬레이션', icon: Activity, count: simSnapshots.length },
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
          {/* 인쇄 — 화면 대신 인쇄 전용 일일 보고서 시트가 출력된다 (브라우저에서 PDF 저장 가능) */}
          <button
            type="button"
            disabled={!canExport}
            title={!canExport ? exportHint : '일일 보고서를 인쇄합니다 (인쇄 대화상자에서 PDF 저장 가능)'}
            onClick={() => window.print()}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[11px] font-bold
              ${theme.panelBorder} ${theme.textSecondary} ${theme.hoverBg}
              disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            <Printer className="w-3.5 h-3.5" /> 인쇄
          </button>
          <button
            type="button"
            disabled={!canExport}
            title={!canExport ? exportHint : undefined}
            onClick={() => downloadReportWorkbook({
              production, events, lineStats, oeeByLine, simSnapshots, maintRows, maintLog, maintKpis,
              dailyTargetByLine, kwhByLine, handoverNotes,
            })}
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
                ['완료 로트', kpis.jobs > 0 ? `${kpis.jobs}건` : '—'],
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

            {/* 품질 파레토 — 불량이 있어야 의미가 있다 */}
            {pareto.total > 0 && (
              <section className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} p-3 ${theme.textSecondary}`}>
                <div className="flex items-baseline justify-between mb-2">
                  <p className={`text-[11px] font-bold ${theme.textMuted}`}>
                    품질 파레토 — 불량 유형 (누적 실적 {pareto.total} EA)
                  </p>
                  <p className={`text-[9px] ${theme.textFaint}`}>
                    막대 = 유형별 수량 · <span className="text-amber-500 font-semibold">주황</span> = 누적 점유율 ·
                    <span className="text-red-500"> 점선</span> = 80% 기준
                  </p>
                </div>
                <ParetoChart theme={theme} pareto={pareto} />
              </section>
            )}

            {/* 불량률 관리도 — 로트가 2건은 있어야 추이가 된다 */}
            {spc.rows.length >= 2 && (
              <section className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} p-3 ${theme.textSecondary}`}>
                <div className="flex items-baseline justify-between mb-2">
                  <p className={`text-[11px] font-bold ${theme.textMuted}`}>
                    불량률 관리도 — 최근 {spc.rows.length}로트 (p-차트 근사)
                  </p>
                  <p className={`text-[9px] ${theme.textFaint}`}>
                    UCL = p̄ + 3√(p̄(1−p̄)/n̄) · 평균 로트 {Math.round(spc.nbar)} EA 기준 근사 ·
                    <span className="text-red-500"> 적색 점</span> = 관리상한 초과
                  </p>
                </div>
                <SpcChart theme={theme} spc={spc} />
              </section>
            )}

            {/* 완료 작업 테이블 */}
            <section className={`rounded-lg border ${theme.panelBorder} overflow-hidden`}>
              <table className="w-full text-[11px]">
                <thead className={theme.headerBg}>
                  <tr className={`border-b ${theme.divider}`}>
                    {['완료 시각', '라인', '품목', '수량', '불량', '계획', '실적', '달성률'].map((h) => (
                      <th key={h} className={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {production.length === 0 && (
                    <tr><td colSpan={8} className={`px-3 py-6 text-center ${theme.textFaint}`}>
                      아직 완료된 로트가 없습니다. 라인이 돌면 실적이 여기에 쌓입니다.
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

        {tab === 'maintenance' && (
          <>
            {/* 요약 칩 — 지금 조치가 필요한 것부터 */}
            <div className="grid grid-cols-3 gap-2">
              {[
                ['소모품 위험 (≤15%)', riskyConsumables.length, riskyConsumables.length > 0],
                ['점검 임박 (D-14 이내)', dueChecks.length, dueChecks.length > 0],
                ['소모품 교체 누적', maintLog.length, false],
              ].map(([k, v, warn]) => (
                <div key={k} className={`rounded-lg border px-3 py-2.5 ${warn ? 'border-red-500/40 bg-red-500/10' : `${theme.panelBorder} ${theme.subtleBg}`}`}>
                  <p className={`text-[10px] ${warn ? 'text-red-500 font-semibold' : theme.textFaint}`}>{k}</p>
                  <p className={`mt-1 text-[17px] font-bold tabular-nums ${warn ? 'text-red-500' : theme.textPrimary}`}>{v}건</p>
                </div>
              ))}
            </div>

            {/* 소모품·점검 현황 — 라인×설비 전체 */}
            <section className={`rounded-lg border ${theme.panelBorder} overflow-hidden`}>
              <table className="w-full text-[11px]">
                <thead className={theme.headerBg}>
                  <tr className={`border-b ${theme.divider}`}>
                    {['라인', '설비', '시리얼', '소모품', '잔량', '예상 잔여', '차기 점검'].map((h) => (
                      <th key={h} className={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {maintRows.map((r) => (
                    <tr key={`${r.lineId}:${r.assetId}`} className={`border-b last:border-0 ${theme.divider}`}>
                      <td className={`${td} ${theme.textSecondary}`}>{lineName(r.lineId)}</td>
                      <td className={`${td} ${theme.textPrimary}`}>{r.name}</td>
                      <td className={`${td} tabular-nums ${theme.textFaint}`}>{r.sn}</td>
                      <td className={`${td} ${theme.textSecondary}`}>{r.label}</td>
                      <td className={`${td} w-40`}>
                        <span className="flex items-center gap-2">
                          <span className={`relative flex-1 h-1.5 rounded-full overflow-hidden ${theme.trackBg}`}>
                            <span
                              className={`absolute inset-y-0 left-0 rounded-full ${r.percent <= CONSUMABLE_WARN_PCT ? 'bg-red-500' : r.percent <= 40 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                              style={{ width: `${r.percent}%` }}
                            />
                          </span>
                          <span className={`w-8 text-right tabular-nums font-semibold ${r.percent <= CONSUMABLE_WARN_PCT ? 'text-red-500' : theme.textSecondary}`}>
                            {r.percent}%
                          </span>
                        </span>
                      </td>
                      <td className={`${td} tabular-nums ${r.percent <= CONSUMABLE_WARN_PCT ? 'text-red-500 font-semibold' : theme.textSecondary}`}>
                        {r.remainEa} EA
                      </td>
                      <td className={`${td} tabular-nums`}>
                        <span className={theme.textFaint}>{r.nextCheck}</span>{' '}
                        {r.dDay != null && (
                          <span className={`font-semibold ${r.dDay < 0 ? 'text-red-500' : r.dDay <= 14 ? 'text-amber-500' : theme.textGhost}`}>
                            {r.dDay < 0 ? `${-r.dDay}일 지남` : r.dDay === 0 ? '오늘' : `D-${r.dDay}`}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* 보전 지표 — MTTA/MTTR/MTBF */}
            <section className={`rounded-lg border ${theme.panelBorder} overflow-hidden`}>
              <div className={`flex items-center justify-between px-3 py-2 border-b ${theme.divider} ${theme.headerBg}`}>
                <span className={`text-[11px] font-bold ${theme.textPrimary}`}>보전 지표 (알람 기준)</span>
                <span className={`text-[9px] ${theme.textFaint}`}>
                  이벤트 로그 보관분 기준 · MTTA 평균 확인 / MTTR 평균 복구 / MTBF 평균 고장 간격
                </span>
              </div>
              <table className="w-full text-[11px]">
                <thead className={theme.headerBg}>
                  <tr className={`border-b ${theme.divider}`}>
                    {['라인', '설비', '발생', 'MTTA', 'MTTR', 'MTBF', '현재'].map((h) => (
                      <th key={h} className={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {maintKpis.length === 0 && (
                    <tr><td colSpan={7} className={`px-3 py-5 text-center ${theme.textFaint}`}>
                      아직 알람 이력이 없습니다. 오류가 발생·조치되면 지표가 여기에 쌓입니다.
                    </td></tr>
                  )}
                  {maintKpis.map((k) => (
                    <tr key={`${k.lineId}:${k.assetId}`} className={`border-b last:border-0 ${theme.divider}`}>
                      <td className={`${td} ${theme.textSecondary}`}>{lineName(k.lineId)}</td>
                      <td className={`${td} ${theme.textPrimary}`}>{findAsset(k.assetId)?.nameKo ?? k.assetId}</td>
                      <td className={`${td} tabular-nums ${theme.textSecondary}`}>{k.occurrences}건</td>
                      <td className={`${td} tabular-nums ${theme.textSecondary}`}>{k.mttaSec == null ? '—' : fmtKoDuration(Math.round(k.mttaSec))}</td>
                      <td className={`${td} tabular-nums ${theme.textSecondary}`}>{k.mttrSec == null ? '—' : fmtKoDuration(Math.round(k.mttrSec))}</td>
                      <td className={`${td} tabular-nums ${theme.textFaint}`}>{k.mtbfSec == null ? '—' : fmtKoDuration(Math.round(k.mtbfSec))}</td>
                      <td className={`${td}`}>
                        {k.openSince ? (
                          <span className="text-[10px] font-bold text-red-500">
                            조치 중 ({fmtClock(k.openSince)}~)
                          </span>
                        ) : (
                          <span className={`text-[10px] ${theme.textGhost}`}>정상</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* 소모품 교체 이력 */}
            <section className={`rounded-lg border ${theme.panelBorder} overflow-hidden`}>
              <table className="w-full text-[11px]">
                <thead className={theme.headerBg}>
                  <tr className={`border-b ${theme.divider}`}>
                    {['교체 시각', '라인', '설비', '소모품', '교체 전 잔량', '작업자'].map((h) => (
                      <th key={h} className={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {maintLog.length === 0 && (
                    <tr><td colSpan={6} className={`px-3 py-6 text-center ${theme.textFaint}`}>
                      아직 교체 이력이 없습니다. 설비 상세 화면의 "교체" 버튼으로 소모품을 교체하면 여기에 쌓입니다.
                    </td></tr>
                  )}
                  {maintLog.map((m) => {
                    const d = new Date(m.at);
                    return (
                      <tr key={m.id} className={`border-b last:border-0 ${theme.divider}`}>
                        <td className={`${td} tabular-nums ${theme.textFaint}`}>{fmtDate(d)} {fmtClock(d)}</td>
                        <td className={`${td} ${theme.textSecondary}`}>{lineName(m.lineId)}</td>
                        <td className={`${td} ${theme.textPrimary}`}>{m.name}</td>
                        <td className={`${td} ${theme.textSecondary}`}>{m.label}</td>
                        <td className={`${td} tabular-nums ${theme.textSecondary}`}>{Math.round(m.percentBefore)}% → 100%</td>
                        <td className={`${td} ${theme.textFaint}`}>{m.user ?? '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </>
        )}

        {tab === 'simulations' && (
          <>
            {/* 비교 카드 — 2개 선택 시 */}
            {compared.length === 2 && (() => {
              const [a, b] = compared;
              const dSec = (x, y) => {
                const d = y - x;
                const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
                return `${sign}${fmtKoDuration(Math.abs(d))}`;
              };
              const dNum = (x, y) => {
                const d = y - x;
                return `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}`;
              };
              /* 낮을수록 좋음 — 동일(Δ0)은 중립. 저장된 소요 시간은 배속으로 나눈
                 벽시계 초라서, 배속이 다른 두 스냅샷의 시간 비교는 색을 칠하지 않는다 */
              const lowerBetter = (x, y) => (y === x ? null : y < x);
              const speedMismatch = (a.speed ?? 1) !== (b.speed ?? 1);
              const rows = [
                ['배속', `×${fmtSpeed(a.speed ?? 1)}`, `×${fmtSpeed(b.speed ?? 1)}`, speedMismatch ? '다름' : '동일', null],
                ['P50 소요', fmtKoDuration(a.p50Sec), fmtKoDuration(b.p50Sec), dSec(a.p50Sec, b.p50Sec), speedMismatch ? null : lowerBetter(a.p50Sec, b.p50Sec)],
                ['P90 소요', fmtKoDuration(a.p90Sec), fmtKoDuration(b.p90Sec), dSec(a.p90Sec, b.p90Sec), speedMismatch ? null : lowerBetter(a.p90Sec, b.p90Sec)],
                ['총 수량', `${a.totalQty} EA`, `${b.totalQty} EA`, `${dNum(a.totalQty, b.totalQty)} EA`, null],
                ['예상 불량', `${a.defectsMean} EA`, `${b.defectsMean} EA`, `${dNum(a.defectsMean, b.defectsMean)} EA`, lowerBetter(a.defectsMean, b.defectsMean)],
                ['반출 실린더', `${a.cylinders}개`, `${b.cylinders}개`, `${dNum(a.cylinders, b.cylinders)}개`, null],
              ];
              return (
                <section className={`rounded-lg border ${theme.panelBorder} ${theme.accentBgSoft} p-3`}>
                  <p className={`text-[11px] font-bold mb-2 ${theme.accentText}`}>스냅샷 비교 (A → B)</p>
                  {speedMismatch && (
                    <p className="text-[10px] leading-relaxed mb-2 text-amber-500">
                      ⚠ 두 스냅샷의 배속이 달라 소요 시간의 단위가 다릅니다 — P50/P90 차이는
                      계획이 아니라 배속 차이일 수 있으니 참고만 하세요.
                    </p>
                  )}
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className={`border-b ${theme.divider}`}>
                        <th className={th}>항목</th>
                        <th className={th}>A · {fmtClock(new Date(a.at))}</th>
                        <th className={th}>B · {fmtClock(new Date(b.at))}</th>
                        <th className={th}>Δ (B−A)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(([k, va, vb, delta, better]) => (
                        <tr key={k} className={`border-b last:border-0 ${theme.divider}`}>
                          <td className={`${td} ${theme.textMuted}`}>{k}</td>
                          <td className={`${td} tabular-nums ${theme.textSecondary}`}>{va}</td>
                          <td className={`${td} tabular-nums ${theme.textSecondary}`}>{vb}</td>
                          <td className={`${td} tabular-nums font-semibold ${better === null ? theme.textSecondary : better ? 'text-emerald-500' : 'text-red-500'}`}>
                            {delta}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              );
            })()}

            <section className={`rounded-lg border ${theme.panelBorder} overflow-hidden`}>
              <table className="w-full text-[11px]">
                <thead className={theme.headerBg}>
                  <tr className={`border-b ${theme.divider}`}>
                    {['비교', '저장 시각', '라인', '로트', '수량', 'P50 소요', '완료 예정', '배속', '불량', '저장자', ''].map((h) => (
                      <th key={h} className={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {simSnapshots.length === 0 && (
                    <tr><td colSpan={11} className={`px-3 py-6 text-center ${theme.textFaint}`}>
                      저장된 스냅샷이 없습니다. 라인 시뮬레이션 결과에서 "리포트에 스냅샷 저장"을 누르면 여기에 쌓입니다.
                    </td></tr>
                  )}
                  {simSnapshots.map((s) => (
                    <tr key={s.id} className={`border-b last:border-0 ${theme.divider}`}>
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={compareIds.includes(s.id)}
                          onChange={() => toggleCompare(s.id)}
                          className="accent-sky-500"
                          title="2개를 선택하면 위에 비교표가 나타납니다"
                        />
                      </td>
                      <td className={`${td} tabular-nums ${theme.textFaint}`}>{fmtDate(new Date(s.at))} {fmtClock(new Date(s.at))}</td>
                      <td className={`${td} ${theme.textSecondary}`}>{lineName(s.lineId)}</td>
                      <td className={`${td} tabular-nums ${theme.textSecondary}`}>{s.lots}건</td>
                      <td className={`${td} tabular-nums ${theme.textSecondary}`}>{s.totalQty} EA</td>
                      <td className={`${td} tabular-nums ${theme.textPrimary}`}>{fmtKoDuration(s.p50Sec)}</td>
                      <td className={`${td} tabular-nums ${theme.textSecondary}`}>{fmtClock(new Date(s.finishAtP50), false)}</td>
                      <td className={`${td} tabular-nums ${theme.textFaint}`}>×{fmtSpeed(s.speed ?? 1)}</td>
                      <td className={`${td} tabular-nums ${theme.textFaint}`}>~{s.defectsMean} EA</td>
                      <td className={`${td} ${theme.textFaint}`}>{s.user ?? '-'}</td>
                      <td className="px-2 py-1.5">
                        {canManageSnapshots && (
                          armedDelete === s.id ? (
                            <button
                              type="button"
                              onClick={() => {
                                /* 비교 선택에서도 지운다 — 고아 id 를 남기지 않는다 */
                                setCompareIds((prev) => prev.filter((x) => x !== s.id));
                                setArmedDelete(null);
                                onDeleteSnapshot?.(s.id);
                              }}
                              onBlur={() => setArmedDelete(null)}
                              className="text-[10px] font-bold text-red-500 whitespace-nowrap"
                              aria-label="삭제 확정"
                              title="한 번 더 누르면 영구 삭제됩니다"
                            >
                              삭제 확정
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setArmedDelete(s.id)}
                              className={`${theme.textGhost} hover:text-red-500 transition`}
                              aria-label="스냅샷 삭제"
                              title="스냅샷 삭제 (한 번 더 눌러 확정)"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
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

      {/* 인쇄 전용 일일 보고서 — 화면에는 보이지 않고 인쇄 시에만 이것만 출력된다 */}
      <PrintReport
        kpis={kpis}
        oeeByLine={oeeByLine}
        lineStats={lineStats}
        production={production}
        maintRows={maintRows}
        maintKpis={maintKpis}
        maintLog={maintLog}
        alarmEvents={alarmEvents}
        spc={spc}
        dailyTargetByLine={dailyTargetByLine}
        kwhByLine={kwhByLine}
        handoverNotes={handoverNotes}
      />
    </Modal>
  );
};

export default ReportModal;
