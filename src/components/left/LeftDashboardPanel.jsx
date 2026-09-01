/**
 * =============================================================================
 *  좌측 패널 — 생산 라인 진행률 / 작업 대기열 / 시뮬레이션 배속
 * =============================================================================
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, FastForward, Gauge, GripVertical, Layers, Pause, Play, Plus, Save, Settings2, Trash2, Upload, X,
} from 'lucide-react';
import { completedEaAt, findAsset } from '../../data/factoryAssets.js';
import { SIM_ASSUMPTIONS, probabilityBefore, simulateLine } from '../../lib/lineSimulation.js';
import {
  SPEED_STEPS, fmtAnimScale, fmtClock, fmtDuration, fmtKoDuration, fmtSpeed, pad,
} from '../../lib/format.js';
import { AnimatedNumber, GhostButton, Panel, PanelTitle, StatusLamp } from '../ui.jsx';
import { fmtShiftRemain, shiftOf, shiftRemainSec } from '../../lib/shift.js';
import HandoverPanel from './HandoverPanel.jsx';

/**
 * 실린더 충전 게이지 — 1세트마다 1칸씩 차고, 가득 차면 반출 후 새 실린더로 비워진다.
 * (공정 개요 5번: 실린더는 여러 세트에 걸쳐 충전돼 만충 시 뒤로 반출)
 */
const CylinderGauge = ({ theme, cylinder }) => (
  <div
    className="flex items-center gap-2"
    title={cylinder.active
      ? `실린더 충전 ${cylinder.fill}/${cylinder.capacity}회 · 만충 시 자동 반출 · 누적 반출 ${cylinder.discharged}개`
      : '진행 중인 로트가 없습니다'}
  >
    <span className={`w-11 text-[11px] shrink-0 ${cylinder.active ? theme.textMuted : theme.textGhost}`}>실린더</span>
    <span className="flex-1 flex gap-0.5">
      {Array.from({ length: cylinder.capacity }).map((_, i) => (
        <span
          key={i}
          className={`h-2 flex-1 rounded-sm transition-colors duration-300 ${i < cylinder.fill ? '' : theme.trackBg}`}
          style={i < cylinder.fill ? { backgroundColor: theme.accentHex } : undefined}
        />
      ))}
    </span>
    <span className={`w-14 text-right text-[11px] tabular-nums ${cylinder.active ? theme.textSecondary : theme.textGhost}`}>
      {cylinder.active ? `${cylinder.fill}/${cylinder.capacity}` : '—'}
    </span>
  </div>
);

/**
 * 생산 진행 곡선(S-커브) — "그 시각에 몇 개까지 나와 있을까".
 *  로트 경계의 P50 완료 시각으로 누적 수량 곡선을 그리고, P90 을 점선 밴드로 겹친다.
 *  두 선의 벌어짐이 곧 계획의 불확실성이다.
 */
const ProgressCurve = ({ theme, timeline, anchorMs }) => {
  const W = 264;
  const H = 96;
  const plotH = 78;
  const totalQty = timeline.reduce((s, r) => s + r.qty, 0);
  const xMax = Math.max(1e-9, timeline[timeline.length - 1].endP90WallSec);
  const xOf = (sec) => (sec / xMax) * (W - 8) + 4;
  const yOf = (qty) => plotH - (qty / Math.max(1, totalQty)) * (plotH - 8);
  let cum = 0;
  const p50Pts = [[xOf(0), yOf(0)]];
  const p90Pts = [[xOf(0), yOf(0)]];
  timeline.forEach((r) => {
    cum += r.qty;
    p50Pts.push([xOf(r.endWallSec), yOf(cum)]);
    p90Pts.push([xOf(r.endP90WallSec), yOf(cum)]);
  });
  const toStr = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="생산 진행 곡선">
      <line x1="4" x2={W - 4} y1={plotH} y2={plotH} stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
      {/* P90 — 늦어질 수 있는 경로 */}
      <polyline points={toStr(p90Pts)} fill="none" stroke={theme.accentHex} strokeWidth="1.1" strokeDasharray="3 3" opacity="0.45" />
      {/* P50 — 기대 경로 */}
      <polyline points={toStr(p50Pts)} fill="none" stroke={theme.accentHex} strokeWidth="1.6" />
      {p50Pts.slice(1).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2" fill={theme.accentHex} />
      ))}
      <text x="4" y={H - 2} fontSize="8" fill="currentColor" opacity="0.45">지금</text>
      <text x={W - 4} y={H - 2} textAnchor="end" fontSize="8" fill="currentColor" opacity="0.45">
        ~{fmtClock(new Date(anchorMs + xMax * 1000), false)}
      </text>
      <text x={W - 4} y="10" textAnchor="end" fontSize="8" fill="currentColor" opacity="0.55">
        {totalQty} EA
      </text>
    </svg>
  );
};

/** 시간 구성 스택바 — 남은 계획의 시간이 어디로 가는가 (표준시간 기준) */
const TimeBreakdownBar = ({ theme, breakdown }) => {
  const stop = Math.max(0, breakdown.stopMeanSec);
  const total = Math.max(1e-9, breakdown.netSec + breakdown.overheadSec + stop);
  const seg = (v) => `${(v / total) * 100}%`;
  const rows = [
    ['정미 생산', breakdown.netSec, theme.accentHex, 1],
    ['도입·마무리', breakdown.overheadSec, theme.accentHex, 0.35],
    ['돌발 정지(평균)', stop, '#ef4444', 0.85],
  ];
  return (
    <div>
      <div className={`flex h-2 rounded-full overflow-hidden ${theme.trackBg}`}>
        {rows.map(([k, v, color, op]) => (
          <span key={k} style={{ width: seg(v), backgroundColor: color, opacity: op }} title={`${k} ${fmtKoDuration(Math.round(v))}`} />
        ))}
      </div>
      <div className={`mt-1 grid grid-cols-3 gap-1 text-[9px] tabular-nums ${theme.textFaint}`}>
        {rows.map(([k, v]) => (
          <span key={k} className="truncate">{k} {Math.round((v / total) * 100)}%</span>
        ))}
      </div>
    </div>
  );
};

const LeftDashboardPanel = ({
  theme, mode, jobs, onRequestCancel, onOpenJobAdd, onOpenExcel,
  selectedJobId, onSelectJob, onReorderJobs, onApplyOrder, onSaveSnapshot,
  speed, onSpeedChange, currentJob, elapsed, now, taktSec, animTimeScale, eStopEngaged,
  todayQty = 0, cylinder, lineAssets, lineId,
  canManageJobs = true, manageHint,
  dailyTarget = 0, onSetDailyTarget,
  handoverNotes = [], onAddHandover, canWriteHandover = true, handoverHint,
  demoAutofill = true, onToggleAutofill,
}) => {
  /* 일일 목표 인라인 편집 (생산 계획 권한) */
  const [targetEdit, setTargetEdit] = useState(null); // null=보기, 문자열=편집 중
  const shift = shiftOf(now);
  /* 저장된 결과 표시 — 같은 결과를 두 번 저장하지 않게 앵커로 구분 */
  const [savedAnchor, setSavedAnchor] = useState(null);
  const progress = currentJob ? Math.min(100, (elapsed / currentJob.totalSec) * 100) : 0;
  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;
  const targetQty = jobs.reduce((sum, j) => sum + j.qty, 0);
  /* 진행 EA — 도입/마무리 애니메이션 구간을 수량으로 오인하지 않는 정확한 카운트 */
  const doneQty = currentJob ? completedEaAt(elapsed, currentJob.qty, taktSec) : 0;

  /* 시뮬레이션 배속을 반영한 시간당 처리량 — 배속을 올리면 즉시 뛴다 */
  const simSpeed = mode === 'simulation' ? speed : 1;
  const throughputPerHour = taktSec > 0 ? Math.round((3600 / taktSec) * simSpeed) : 0;

  /* 대기열 드래그 정렬 */
  const dragFrom = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const finishAt = useMemo(() => {
    if (!currentJob) return '--:--';
    const remain = (currentJob.totalSec - elapsed) / speed;
    return fmtClock(new Date(now.getTime() + remain * 1000), false);
  }, [currentJob, elapsed, speed, now]);

  /**
   * 라인 몬테카를로 시뮬레이션 — 결정식(표준시간 합)으로는 못 구하는 것들을 뽑는다:
   *  완료 시각의 확률 분포, 병목 개선 민감도, 소모품 소진 리스크, 자재 계획.
   *  진행바는 연출이 아니라 '실제 반복 횟수'다 (결과에 계산 시간도 표기).
   */
  const [lineSim, setLineSim] = useState(null); // null | {progress:{done,total}} | {done, result}
  const [dueTarget, setDueTarget] = useState(''); // 목표 납기 'HH:MM'
  const simCancelRef = useRef(null);
  const startLineSim = () => {
    if (simCancelRef.current) {
      simCancelRef.current.cancelled = true;
      clearInterval(simCancelRef.current.timer);
    }
    const control = { cancelled: false, timer: null, realDone: 0, result: null };
    simCancelRef.current = control;
    const RUNS = 2000;
    /* 계산은 실제 몬테카를로 그대로 돌리되, 진행 바는 최소 이 시간에 걸쳐 차오르게
       페이싱한다 — '일이 되고 있다'는 감각용. 캡션의 실제 계산 ms 는 그대로 정직하다. */
    const MIN_DISPLAY_MS = 1400;
    const t0 = Date.now();
    setLineSim({ progress: { done: 0, total: RUNS } });

    simulateLine({
      lots: jobs,
      headElapsedSec: elapsed,
      carryFill: cylinder?.fill ?? 0, // 실린더 이월 채움 — 반출 수가 게이지와 일치하게
      speed: simSpeed,
      runs: RUNS,
      assets: lineAssets, // 이 라인의 설비 인스턴스 — 소모품 리스크가 호기별로 다르다

      onProgress: (done) => {
        control.realDone = done;
      },
      isCancelled: () => control.cancelled,
    }).then((result) => {
      if (!control.cancelled && result) control.result = result;
    });

    control.timer = setInterval(() => {
      if (control.cancelled) {
        clearInterval(control.timer);
        return;
      }
      const paced = Math.floor(RUNS * Math.min(1, (Date.now() - t0) / MIN_DISPLAY_MS));
      const shown = Math.min(control.realDone, paced);
      if (control.result && shown >= RUNS) {
        clearInterval(control.timer);
        /* 모든 '시각'은 결과 확정 시점의 벽시계에 고정한다 — 라이브 값과 섞으면
           배속 변경·로트 전환 때 표시가 표류하거나 점프한다 */
        const now = Date.now();
        const result = control.result;
        setLineSim({
          done: true,
          result: {
            ...result,
            anchorMs: now,
            finishAtP50: new Date(now + result.finishWallSec.p50 * 1000),
            finishAtP90: new Date(now + result.finishWallSec.p90 * 1000),
            consumables: result.consumables.map((c) =>
              c.ok ? c : { ...c, replaceAt: new Date(now + (c.runOutSec / result.speed) * 1000) }
            ),
          },
        });
        /* 기본 납기 목표 = 90% 신뢰 상한을 '분 올림'한 시각 —
           절사하면 P90 보다 이른 목표가 되어 표시 확률이 90% 아래로 어긋난다 */
        setDueTarget(fmtClock(new Date(Math.ceil((now + result.finishWallSec.p90 * 1000) / 60000) * 60000), false));
      } else {
        setLineSim({ progress: { done: shown, total: RUNS } });
      }
    }, 60);
  };
  const stopLineSim = () => {
    if (simCancelRef.current) {
      simCancelRef.current.cancelled = true;
      clearInterval(simCancelRef.current.timer);
    }
    setLineSim(null);
  };
  useEffect(() => () => {
    if (simCancelRef.current) {
      simCancelRef.current.cancelled = true;
      clearInterval(simCancelRef.current.timer);
    }
  }, []);

  /** 목표 납기(HH:MM)를 앵커 기준 초로 바꿔 달성 확률을 계산한다 */
  const dueProbabilityOf = (r) => {
    if (!dueTarget) return null;
    const [h, m] = dueTarget.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    const target = new Date(r.anchorMs);
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= r.anchorMs) target.setDate(target.getDate() + 1); // 지난 시각은 다음날로
    return probabilityBefore(r.totalsWallSorted, (target.getTime() - r.anchorMs) / 1000);
  };

  return (
    <aside className="w-[320px] shrink-0 h-full flex flex-col gap-3 p-3 overflow-y-auto">
      {/* 작업 진행률 --------------------------------------------- */}
      <Panel theme={theme} className={theme.glow} data-tour="progress">
        <PanelTitle
          icon={Gauge}
          title="생산 라인 진행률"
          theme={theme}
          hint="현재 로트의 진행률과, 각 EA가 개포장→이송→충전→검사 파이프라인을 통과하는 현황입니다. 로트가 완료되면 대기열이 전진하고 실적은 리포트에 쌓입니다."
          right={
            mode === 'simulation' && speed > 1 ? (
              /* 가속 중임을 한눈에 — 배속을 올리면 여기부터 달라진다 */
              <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border font-bold ${theme.chip}`}>
                <FastForward className={`w-3 h-3 ${theme.accentText}`} />
                ×{fmtSpeed(speed)} 가속
              </span>
            ) : (
              /* 교대 실동작 — 지금이 어느 조인지 · 교대 종료까지 얼마나 남았는지 */
              <span
                className={`text-[10px] px-2 py-0.5 rounded border tabular-nums ${theme.chip}`}
                title={`${shift.label} 종료까지 ${fmtShiftRemain(shiftRemainSec(now))} 남음 (2교대 · 08~20/20~08)`}
              >
                {shift.key === 'DAY' ? '☀' : '☾'} {shift.label} · {fmtShiftRemain(shiftRemainSec(now))}
              </span>
            )
          }
        />
        <div className="p-3 space-y-3">
          <div className="flex items-end justify-between">
            <div className="min-w-0">
              <p className={`text-3xl font-bold tabular-nums leading-none ${theme.textPrimary}`}>
                <AnimatedNumber value={progress} format={(v) => v.toFixed(0)} />
                <span className={`text-base ml-0.5 ${theme.textMuted}`}>%</span>
              </p>
              <p className={`mt-1 truncate text-[11px] ${theme.textFaint}`}>
                현재 로트 · {currentJob ? `${currentJob.name} (${currentJob.id})` : '-'}
              </p>
            </div>
            {/* 비상 정지 중에는 '작업 중' 대신 정지 상태를 보여준다 */}
            <StatusLamp state={eStopEngaged ? 'STOPPED' : currentJob?.state ?? 'IDLE'} />
          </div>

          <div>
            <div className={`h-2.5 rounded-full overflow-hidden ${theme.trackBg}`}>
              <div
                className={`h-full rounded-full bg-gradient-to-r ${theme.barFrom} ${theme.barTo}`}
                style={{ width: `${progress}%`, transition: 'width 900ms linear' }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-center gap-2 text-[13px] font-bold tabular-nums">
              <span className={theme.textPrimary}>{fmtDuration(elapsed)}</span>
              <span className={theme.textGhost}>/</span>
              <span className={theme.textFaint}>{fmtDuration(currentJob?.totalSec ?? 0)}</span>
            </div>
          </div>

          <div className={`grid grid-cols-4 gap-1.5 rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-2 py-2 text-center`}>
            {[
              ['대기 물량', <AnimatedNumber key="t" value={targetQty} />],
              ['진행', <AnimatedNumber key="d" value={doneQty} />],
              /* 완료 누적 — 로트가 끝나는 순간 카운트업 + 펄스로 점프가 눈에 띈다 */
              ['금일 생산', <span key={`q-${todayQty}`} className="anim-stat"><AnimatedNumber value={todayQty} /></span>],
              ['완료 예정', finishAt],
            ].map(([k, v], i) => (
              <div key={k}>
                <p className={`text-[10px] ${theme.textFaint}`}>{k}</p>
                <p className={`mt-0.5 text-[12px] font-semibold tabular-nums ${i === 2 ? theme.accentText : theme.textSecondary}`}>
                  {v}
                </p>
              </div>
            ))}
          </div>

          {/* 일일 목표 대비 달성 — "오늘 얼마나 왔나"의 분모. 목표는 관리 권한이 인라인 수정 */}
          <div>
            <div className="flex items-center justify-between text-[10px]">
              <span className={theme.textFaint}>일일 목표 대비</span>
              {targetEdit === null ? (
                <button
                  type="button"
                  disabled={!canManageJobs}
                  title={canManageJobs ? '클릭해서 일일 목표 수량을 수정합니다' : manageHint}
                  onClick={() => setTargetEdit(String(dailyTarget))}
                  className={`tabular-nums ${theme.textMuted} ${canManageJobs ? 'hover:underline cursor-pointer' : 'cursor-default'}`}
                >
                  목표 {dailyTarget} EA{canManageJobs ? ' ✎' : ''}
                </button>
              ) : (
                <span className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={targetEdit}
                    onChange={(e) => setTargetEdit(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onSetDailyTarget?.(Number(targetEdit));
                        setTargetEdit(null);
                      }
                      if (e.key === 'Escape') setTargetEdit(null);
                    }}
                    onBlur={() => {
                      onSetDailyTarget?.(Number(targetEdit));
                      setTargetEdit(null);
                    }}
                    className={`w-16 h-5 px-1.5 rounded border text-right text-[10px] tabular-nums
                      ${theme.panelBorder} ${theme.inputBg} ${theme.textPrimary} focus:outline-none focus:ring-1 ${theme.accentRing}`}
                  />
                  <span className={theme.textFaint}>EA</span>
                </span>
              )}
            </div>
            <div className={`mt-1 h-1.5 rounded-full overflow-hidden ${theme.trackBg}`}>
              <div
                className={`h-full rounded-full bg-gradient-to-r ${theme.barFrom} ${theme.barTo}`}
                style={{
                  width: `${dailyTarget > 0 ? Math.min(100, (todayQty / dailyTarget) * 100) : 0}%`,
                  transition: 'width 700ms ease',
                }}
              />
            </div>
            <p className={`mt-0.5 text-right text-[10px] tabular-nums
              ${dailyTarget > 0 && todayQty >= dailyTarget ? 'text-emerald-500 font-semibold' : theme.textGhost}`}>
              {dailyTarget > 0
                ? `달성 ${Math.round((todayQty / dailyTarget) * 100)}%${todayQty >= dailyTarget ? ' — 목표 달성 🎉' : ''}`
                : '목표 미설정'}
            </p>
          </div>

          {/* 단계별(개포장/이송/충전/검사) 집계는 두지 않는다 — 1세트 단위 흐름 공정.
              대신 실린더 만충 현황을 보여준다: 1세트 = 1회 충전, 8회에 만충 → 반출 */}
          {cylinder && (
            <div className="pt-1 space-y-1">
              <CylinderGauge theme={theme} cylinder={cylinder} />
              <p className={`pl-[52px] text-[10px] tabular-nums ${theme.textGhost}`}>
                만충 시 자동 반출 · 누적 반출 {cylinder.discharged}개
              </p>
            </div>
          )}
        </div>
      </Panel>

      {/* 작업 대기열 --------------------------------------------- */}
      <Panel theme={theme} className="flex-1 min-h-[220px] flex flex-col" data-tour="queue">
        <PanelTitle
          icon={Layers}
          title="생산 오더 대기열"
          theme={theme}
          hint="작업지시는 로트(품목+수량) 단위입니다. 맨 위 로트가 지금 라인을 흐르고 있고, 행을 드래그해 생산 순서를 바꿀 수 있습니다. '자동' 이 켜져 있으면 대기열이 비는 순간 카탈로그에서 데모 로트가 보충됩니다."
          right={
            <span className="flex items-center gap-1.5">
              {/* 데모 오토필 — 방치해도 공장이 계속 돌게 */}
              <button
                type="button"
                disabled={!canManageJobs}
                onClick={onToggleAutofill}
                title={canManageJobs
                  ? (demoAutofill ? '대기열 자동 보충 켜짐 — 클릭해서 끄기' : '대기열 자동 보충 꺼짐 — 클릭해서 켜기')
                  : manageHint}
                className={`px-1.5 py-0.5 rounded border text-[9px] font-bold transition-colors
                  disabled:cursor-not-allowed
                  ${demoAutofill
                    ? `${theme.accentBgSoft} ${theme.accentText}`
                    : `${theme.chip} opacity-60`}`}
                style={demoAutofill ? { borderColor: theme.accentHex } : undefined}
              >
                자동 {demoAutofill ? 'ON' : 'OFF'}
              </button>
              <span className={`text-[10px] tabular-nums ${theme.textFaint}`}>{jobs.length} LOTS</span>
            </span>
          }
        />

        <ul className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {jobs.map((job, idx) => {
            const picked = job.id === selectedJobId;
            return (
            <li
              key={job.id}
              onClick={() => onSelectJob(picked ? null : job.id)}
              aria-selected={picked}
              draggable={canManageJobs}
              onDragStart={(e) => {
                dragFrom.current = idx;
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (dragFrom.current === null) return;
                e.preventDefault(); // drop 을 허용
                setDragOverIdx(idx);
              }}
              onDragLeave={() => setDragOverIdx((cur) => (cur === idx ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragFrom.current;
                dragFrom.current = null;
                setDragOverIdx(null);
                if (from !== null && from !== idx) onReorderJobs?.(from, idx);
              }}
              onDragEnd={() => { dragFrom.current = null; setDragOverIdx(null); }}
              className={`group flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors cursor-pointer
                ${idx === 0 ? `${theme.accentBgSoft} ${theme.panelBorder}` : `${theme.panelBorder} ${theme.cardBg} ${theme.hoverBg}`}`}
              style={{
                ...(picked ? { borderColor: theme.accentHex, boxShadow: `inset 0 0 0 1px ${theme.accentHex}` } : null),
                ...(dragOverIdx === idx ? { borderColor: theme.accentHex, borderStyle: 'dashed' } : null),
              }}
            >
              <GripVertical
                className={`w-3.5 h-3.5 shrink-0 ${canManageJobs ? `cursor-grab ${theme.textFaint}` : theme.textGhost}`}
              />
              <span className={`w-5 text-[10px] tabular-nums ${theme.textGhost}`}>{pad(idx + 1)}</span>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[12px] font-medium ${theme.textSecondary}`}>{job.name}</p>
                <p className={`text-[10px] tabular-nums ${theme.textFaint}`}>
                  {job.id} · {job.qty} EA · 택트 {job.taktSec ?? (job.qty > 0 ? (job.totalSec / job.qty).toFixed(1) : '-')}s · {fmtDuration(job.totalSec)}
                </p>
              </div>
              {/* 정지 중이면 돌고 있던 작업만 '작업 중지'로 — 대기 작업은 원래대로 대기다 */}
              <StatusLamp
                state={eStopEngaged && job.state === 'RUNNING' ? 'STOPPED' : job.state}
                showLabel={false}
              />
              {/* 휴지통도 같은 확인 팝업을 거친다 — 한쪽만 즉시 삭제되면 위험하다 */}
              {canManageJobs && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRequestCancel(job); }}
                  className={`opacity-0 group-hover:opacity-100 transition hover:text-red-500 ${theme.textFaint}`}
                  aria-label={`${job.name} 취소`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
            );
          })}
        </ul>

        <footer className={`grid grid-cols-3 gap-1.5 p-2 border-t ${theme.divider}`}>
          <GhostButton
            icon={Plus} theme={theme} onClick={onOpenJobAdd}
            disabled={!canManageJobs} title={!canManageJobs ? manageHint : undefined}
          >
            로트 추가
          </GhostButton>
          <GhostButton
            icon={Upload} theme={theme} onClick={onOpenExcel}
            disabled={!canManageJobs} title={!canManageJobs ? manageHint : undefined}
          >
            엑셀 업로드
          </GhostButton>
          <GhostButton
            icon={X}
            theme={theme}
            danger
            disabled={!canManageJobs || !selectedJob}
            title={!canManageJobs
              ? manageHint
              : selectedJob ? `${selectedJob.name} 취소` : '대기열에서 취소할 작업을 먼저 선택하세요'}
            onClick={() => selectedJob && onRequestCancel(selectedJob)}
          >
            취소
          </GhostButton>
        </footer>
        {!selectedJob && canManageJobs && (
          <p className={`px-2 pb-2 -mt-1 text-[10px] ${theme.textGhost}`}>
            작업을 클릭해 선택하면 취소할 수 있습니다.
          </p>
        )}
        {!canManageJobs && (
          <p className={`px-2 pb-2 -mt-1 text-[10px] ${theme.textGhost}`}>
            현재 계정은 조회 전용입니다. 작업 관리는 운영자 이상 권한이 필요합니다.
          </p>
        )}
      </Panel>

      {/* 시뮬레이션 배속 ------------------------------------------ */}
      <Panel theme={theme} data-tour="speed">
        <PanelTitle
          icon={Settings2}
          title="시뮬레이션 배속"
          theme={theme}
          hint="시뮬레이션 모드에서만 조절됩니다. 배속은 경과시간·3D 설비 동작·처리량에 모두 함께 적용됩니다."
          right={<span className={`text-xs font-bold tabular-nums ${theme.accentText}`}>{fmtSpeed(speed)}x</span>}
        />
        <div className="p-3 pt-2.5">
          {/* 값이 불균등(0.25~4)이라 슬라이더는 인덱스를 다룬다 */}
          <input
            type="range"
            min={0} max={SPEED_STEPS.length - 1} step={1}
            value={Math.max(0, SPEED_STEPS.indexOf(speed))}
            disabled={mode !== 'simulation'}
            onChange={(e) => onSpeedChange(SPEED_STEPS[Number(e.target.value)])}
            className={`w-full h-1.5 rounded-full appearance-none cursor-pointer ${theme.trackBg}
              disabled:opacity-40 disabled:cursor-not-allowed
              ${mode === 'simulation' ? 'accent-fuchsia-500' : 'accent-sky-500'}`}
          />
          <div className={`flex justify-between mt-1.5 text-[9px] tabular-nums ${theme.textFaint}`}>
            {SPEED_STEPS.map((v) => (
              <span key={v} className={v === speed ? `font-bold ${theme.accentText}` : ''}>{fmtSpeed(v)}x</span>
            ))}
          </div>

          {/* 3D 애니메이션 연동 + 처리량 — 배속을 올리면 처리량이 그 자리에서 뛴다 */}
          <div className={`mt-2.5 grid grid-cols-3 gap-1.5 rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-2 py-2 text-center`}>
            <div>
              <p className={`text-[10px] ${theme.textFaint}`}>택트타임</p>
              <p className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.textSecondary}`}>
                {taktSec.toFixed(1)}s
              </p>
            </div>
            <div>
              <p className={`text-[10px] ${theme.textFaint}`}>3D 배속</p>
              <p className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.accentText}`}>
                ×{fmtAnimScale(animTimeScale)}
              </p>
            </div>
            <div>
              <p className={`text-[10px] ${theme.textFaint}`}>처리량</p>
              <p className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.accentText}`}>
                {throughputPerHour} <span className={`text-[9px] ${theme.textFaint}`}>EA/h</span>
              </p>
            </div>
          </div>

          {mode === 'simulation' && speed > 1 && (
            <p className={`mt-2 text-[10px] leading-relaxed ${theme.accentText}`}>
              <FastForward className="inline w-3 h-3 mr-0.5 align-[-2px]" />
              실시간 대비 <b>×{fmtSpeed(speed)}</b> 빠르게 생산 중 — 1시간에 약 {throughputPerHour} EA
            </p>
          )}
          {mode !== 'simulation' && (
            <p className={`mt-2 text-[10px] leading-relaxed ${theme.textFaint}`}>
              실시간 운전 중에는 배속 조절이 잠깁니다. 시뮬레이션 모드로 전환하세요.
            </p>
          )}
        </div>
      </Panel>

      {/* 라인 시뮬레이션 (몬테카를로) ------------------------------ */}
      <Panel theme={theme} data-tour="line-sim" className={mode === 'simulation' ? theme.glow : ''}>
        <PanelTitle
          icon={Activity}
          title="라인 시뮬레이션"
          theme={theme}
          hint="대기열 전체를 확률 모델(사이클 편차·돌발 정지)로 수천 번 돌려 완료 시각의 분포, 병목 개선 효과, 소모품 소진 리스크를 예측합니다. 실제 라인 상태에는 영향이 없습니다."
          right={
            <span className={`text-[10px] px-2 py-0.5 rounded border ${theme.chip}`}>
              {mode === 'simulation' ? 'MONTE CARLO' : 'LIVE 잠금'}
            </span>
          }
        />
        <div className="p-3 space-y-2.5">
          <p className={`text-[10px] tabular-nums ${theme.textFaint}`}>
            대기열 로트 {jobs.length}건 · 총 {jobs.reduce((s, j) => s + j.qty, 0)} EA · 표준{' '}
            {fmtKoDuration(Math.max(0, jobs.reduce((s, j) => s + j.totalSec, 0) - elapsed))} 남음
          </p>

          {lineSim && !lineSim.done && (
            <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
              <div className="flex items-center justify-between text-[11px]">
                <span className={theme.textMuted}>시뮬레이션 실행 중</span>
                <span className={`font-bold tabular-nums ${theme.accentText}`}>
                  {lineSim.progress.done.toLocaleString()} / {lineSim.progress.total.toLocaleString()}회
                </span>
              </div>
              <div className={`mt-1.5 h-1.5 rounded-full overflow-hidden ${theme.trackBg}`}>
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${theme.barFrom} ${theme.barTo}`}
                  style={{ width: `${(lineSim.progress.done / lineSim.progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {lineSim?.done && (() => {
            const r = lineSim.result;
            const risky = r.consumables.filter((c) => !c.ok);
            const maxBin = Math.max(1, ...r.histogram.bins);
            const sens = r.sensitivity;
            return (
              <div className="space-y-2">
                {/* 완료 시각 — 중앙값 + 90% 신뢰 상한 */}
                <div className={`rounded-lg border ${theme.panelBorder} ${theme.accentBgSoft} px-3 py-2.5`}>
                  <div className="flex items-baseline justify-between">
                    <span className={`text-[10px] ${theme.textFaint}`}>완료 예정 (중앙값)</span>
                    <span className={`text-[10px] tabular-nums ${theme.textMuted}`}>
                      90% 확률 {fmtClock(r.finishAtP90, false)} 이전
                    </span>
                  </div>
                  <p className={`mt-0.5 text-[20px] font-bold tabular-nums leading-none ${theme.accentText}`}>
                    {fmtClock(r.finishAtP50, false)}
                  </p>

                  {/* 완료 시간 분포 히스토그램 — 2,000회의 흩어짐 */}
                  <div className="mt-2 flex items-end gap-[1px] h-9" aria-label="완료 시간 분포">
                    {r.histogram.bins.map((b, i) => (
                      <span
                        key={i}
                        className="flex-1 rounded-t-[2px]"
                        style={{
                          height: `${Math.max(4, (b / maxBin) * 100)}%`,
                          backgroundColor: theme.accentHex,
                          opacity: b === 0 ? 0.12 : 0.35 + 0.65 * (b / maxBin),
                        }}
                        title={`${b}회`}
                      />
                    ))}
                  </div>
                  <div className={`mt-0.5 flex justify-between text-[9px] tabular-nums ${theme.textGhost}`}>
                    <span>{fmtKoDuration(r.histogram.minSec)}</span>
                    <span>소요 분포</span>
                    <span>{fmtKoDuration(r.histogram.maxSec)}</span>
                  </div>

                  {/* 교대·금일 연계 확률 — "이 계획, 우리 조에서 끝나나?" */}
                  {(() => {
                    const anchor = new Date(r.anchorMs);
                    const shiftEndSec = (shiftOf(anchor).endAt.getTime() - r.anchorMs) / 1000;
                    const midnight = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1);
                    const midnightSec = (midnight.getTime() - r.anchorMs) / 1000;
                    const pShift = probabilityBefore(r.totalsWallSorted, shiftEndSec);
                    const pToday = probabilityBefore(r.totalsWallSorted, midnightSec);
                    const chip = (label, p) => (
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold tabular-nums
                          ${p >= 0.9 ? 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10'
                            : p >= 0.5 ? `${theme.chip}`
                            : 'text-amber-500 border-amber-500/40 bg-amber-500/10'}`}
                      >
                        {label} {Math.round(p * 100)}%
                      </span>
                    );
                    return (
                      <div className="mt-2 flex items-center gap-1.5">
                        {chip(`${shiftOf(anchor).label} 내 완료`, pShift)}
                        {chip('금일 내 완료', pToday)}
                      </div>
                    );
                  })()}
                </div>

                {/* 생산 진행 곡선 — 시각별 누적 완성 수량 (P50 실선 · P90 점선) */}
                <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2 ${theme.textSecondary}`}>
                  <div className="flex items-baseline justify-between mb-1">
                    <p className={`text-[10px] font-bold ${theme.textMuted}`}>생산 진행 곡선</p>
                    <p className={`text-[9px] ${theme.textGhost}`}>실선 P50 · 점선 P90 — 벌어질수록 불확실</p>
                  </div>
                  <ProgressCurve theme={theme} timeline={r.timeline} anchorMs={r.anchorMs} />
                </div>

                {/* 시간 구성 — 남은 계획의 시간이 어디로 가는가 */}
                {r.breakdown && (
                  <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <p className={`text-[10px] font-bold ${theme.textMuted}`}>시간 구성 (표준시간 기준)</p>
                      <p className={`text-[9px] tabular-nums ${theme.textGhost}`}>
                        사이클 편차 평균 {r.breakdown.jitterMeanSec >= 0 ? '+' : '−'}{fmtKoDuration(Math.round(Math.abs(r.breakdown.jitterMeanSec)))}
                      </p>
                    </div>
                    <TimeBreakdownBar theme={theme} breakdown={r.breakdown} />
                    <p className={`mt-1.5 text-[10px] leading-relaxed tabular-nums ${theme.textFaint}`}>
                      돌발 정지 평균 <b>{r.breakdown.stopMeanCount.toFixed(1)}회 · {fmtKoDuration(Math.round(r.breakdown.stopMeanSec))}</b> 손실
                      {r.breakdown.stopP90Sec > r.breakdown.stopMeanSec
                        ? <> — 운 나쁜 날(상위 10%)은 {fmtKoDuration(Math.round(r.breakdown.stopP90Sec))} 이상, 최악 {r.breakdown.stopMaxCount}회까지.</>
                        : <> — 10회 중 9회는 정지 없이 통과하지만, 최악 {r.breakdown.stopMaxCount}회까지 발생했습니다.</>}
                    </p>
                  </div>
                )}

                {/* ① 로트별 간트 타임라인 — P50 시작~종료 띠 + P90 리스크 수염 */}
                <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
                  <p className={`text-[10px] font-bold mb-1.5 ${theme.textMuted}`}>로트별 타임라인 (P50)</p>
                  <div className="space-y-1">
                    {r.timeline.map((row) => {
                      const span = Math.max(1e-9, r.timeline[r.timeline.length - 1].endP90WallSec);
                      const left = (row.startWallSec / span) * 100;
                      const width = Math.max(1.5, ((row.endWallSec - row.startWallSec) / span) * 100);
                      const whisker = ((row.endP90WallSec - row.endWallSec) / span) * 100;
                      return (
                        <div
                          key={row.id}
                          className="flex items-center gap-1.5"
                          title={`${row.name} · ${row.qty} EA · ${fmtClock(new Date(r.anchorMs + row.endWallSec * 1000), false)} 완료 예정 (90%: ${fmtClock(new Date(r.anchorMs + row.endP90WallSec * 1000), false)})`}
                        >
                          <span className={`w-8 shrink-0 text-[9px] tabular-nums truncate ${theme.textFaint}`}>
                            {String(row.id).split('-').pop()}
                          </span>
                          <span className={`relative flex-1 h-2 rounded-sm overflow-hidden ${theme.trackBg}`}>
                            <span
                              className="absolute inset-y-0 rounded-sm"
                              style={{ left: `${left}%`, width: `${width}%`, backgroundColor: theme.accentHex, opacity: 0.85 }}
                            />
                            {/* P90 리스크 수염 — 늦어질 수 있는 범위 */}
                            <span
                              className="absolute inset-y-0"
                              style={{ left: `${left + width}%`, width: `${whisker}%`, backgroundColor: theme.accentHex, opacity: 0.25 }}
                            />
                          </span>
                          <span className={`w-9 shrink-0 text-right text-[9px] tabular-nums ${theme.textSecondary}`}>
                            {fmtClock(new Date(r.anchorMs + row.endWallSec * 1000), false)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ② 목표 납기 → 달성 확률 */}
                {(() => {
                  const prob = dueProbabilityOf(r);
                  const pct = prob === null ? null : Math.round(prob * 100);
                  const tone = pct === null ? theme.textGhost : pct >= 90 ? 'text-emerald-500' : pct >= 50 ? 'text-amber-500' : 'text-red-500';
                  return (
                    <div className={`flex items-center gap-2 rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
                      <span className={`text-[10px] shrink-0 ${theme.textMuted}`}>목표 납기</span>
                      <input
                        type="time"
                        value={dueTarget}
                        onChange={(e) => setDueTarget(e.target.value)}
                        className={`h-6 px-1.5 rounded border text-[11px] tabular-nums ${theme.panelBorder} ${theme.inputBg} ${theme.textPrimary}
                          focus:outline-none focus:ring-2 ${theme.accentRing}`}
                      />
                      <span className={`ml-auto text-[12px] font-bold tabular-nums ${tone}`}>
                        {pct === null ? '—' : `달성 확률 ${pct}%`}
                      </span>
                    </div>
                  );
                })()}

                {/* 산출 요약 */}
                <div className={`grid grid-cols-3 gap-1.5 rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-2 py-2 text-center`}>
                  {[
                    ['생산', `${r.summary.totalQty} EA`],
                    ['예상 불량', `~${r.defects.mean} EA`],
                    ['반출 실린더', `${r.summary.cylinders}개`],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className={`text-[10px] ${theme.textFaint}`}>{k}</p>
                      <p className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.textSecondary}`}>{v}</p>
                    </div>
                  ))}
                </div>

                {/* ③ 로트 순서 최적화 제안 — SPT (진행 중인 선두는 고정) */}
                {r.orderSuggestion.improvable ? (
                  <div className={`flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2`}>
                    <p className="flex-1 text-[10px] leading-relaxed tabular-nums text-amber-600">
                      짧은 로트 우선 정렬 시 로트당 평균{' '}
                      <b>{fmtKoDuration(r.orderSuggestion.savedAvgSec / r.speed)}</b> 먼저 완료됩니다
                    </p>
                    <button
                      type="button"
                      disabled={!canManageJobs}
                      title={!canManageJobs ? manageHint : '대기 로트를 짧은 순으로 재정렬합니다 (진행 중인 로트는 그대로)'}
                      onClick={() => {
                        onApplyOrder?.(r.orderSuggestion.order);
                        stopLineSim(); // 순서가 바뀌면 결과가 낡으므로 지운다
                      }}
                      className={`shrink-0 h-7 px-2.5 rounded-md text-[10px] font-bold text-white ${theme.accentBg}
                        hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed`}
                    >
                      정렬 적용
                    </button>
                  </div>
                ) : (
                  jobs.length > 2 && (
                    <p className="text-[10px] leading-relaxed text-emerald-500">
                      ✓ 현재 생산 순서가 이미 최적입니다 (짧은 로트 우선)
                    </p>
                  )
                )}

                {/* 병목 개선 민감도 — what-if */}
                <p className={`text-[10px] leading-relaxed tabular-nums ${theme.textMuted}`}>
                  병목 <b className={theme.textSecondary}>{findAsset(sens.bottleneckId)?.nameKo}</b>{' '}
                  {Math.round(sens.improve * 100)}% 개선 시{' '}
                  <b className={theme.accentText}>−{fmtKoDuration(sens.savedSec / r.speed)}</b>
                  {sens.newBottleneckId && (
                    <> · 새 병목: {findAsset(sens.newBottleneckId)?.nameKo}</>
                  )}
                </p>

                {/* 소모품 리스크 */}
                {risky.length > 0 ? (
                  risky.map((c) => (
                    <p key={c.assetId} className="text-[10px] leading-relaxed tabular-nums text-red-500">
                      ⚠ {findAsset(c.assetId)?.nameKo} {c.label} {c.percent}% — 약 {c.remainingEa} EA 후
                      소진 (잔여 계획 {c.neededEa} EA), {fmtClock(c.replaceAt, false)}경 교체 필요
                    </p>
                  ))
                ) : (
                  <p className="text-[10px] leading-relaxed text-emerald-500">
                    ✓ 소모품 전 항목 잔여 계획 완주 가능
                  </p>
                )}

                {/* 스냅샷 저장 — 리포트 센터 '시뮬레이션' 탭에서 계획끼리 비교한다.
                    공유 저장소(30건 캡)를 덮어쓰는 조작이라 정렬 적용과 같은 권한으로 잠근다 */}
                <GhostButton
                  icon={Save}
                  theme={theme}
                  className="w-full"
                  disabled={!canManageJobs || savedAnchor === r.anchorMs}
                  title={!canManageJobs ? manageHint : undefined}
                  onClick={() => {
                    onSaveSnapshot?.(r);
                    setSavedAnchor(r.anchorMs);
                  }}
                >
                  {savedAnchor === r.anchorMs ? '리포트에 저장됨 ✓' : '리포트에 스냅샷 저장'}
                </GhostButton>

                <p className={`text-[9px] tabular-nums ${theme.textGhost}`}>
                  몬테카를로 {r.runs.toLocaleString()}회 · {r.tookMs}ms · 사이클 편차 ±3% ·
                  돌발 정지 {SIM_ASSUMPTIONS.microStopProbPerEa * 100}%/EA · ×{fmtSpeed(r.speed)} 배속 기준
                </p>
              </div>
            );
          })()}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={startLineSim}
              disabled={mode !== 'simulation' || jobs.length === 0 || Boolean(lineSim && !lineSim.done)}
              title={mode !== 'simulation' ? '시뮬레이션 모드에서 사용할 수 있습니다.' : jobs.length === 0 ? '대기열에 로트가 없습니다.' : undefined}
              className={`inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[12px] font-semibold
                text-white transition ${theme.accentBg} hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              <Play className="w-4 h-4" /> {lineSim?.done ? '다시 실행' : '시작'}
            </button>
            <button
              type="button"
              onClick={stopLineSim}
              disabled={!lineSim}
              className={`inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[12px] font-semibold
                border ${theme.panelBorder} ${theme.textSecondary} ${theme.hoverBg} transition
                disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              <Pause className="w-4 h-4" /> {lineSim?.done ? '결과 지우기' : '중지'}
            </button>
          </div>
        </div>
      </Panel>

      {/* 교대 인수인계 — key 로 라인 전환 시 리마운트: 쓰다 만 초안이 다른 라인
          선택 상태에서 저장돼 엉뚱한 라인으로 귀속되는 것을 막는다 */}
      <HandoverPanel
        key={lineId}
        theme={theme}
        notes={handoverNotes}
        onAdd={onAddHandover}
        canWrite={canWriteHandover}
        hint={handoverHint}
      />
    </aside>
  );
};

export default LeftDashboardPanel;
