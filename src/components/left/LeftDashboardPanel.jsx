/**
 * =============================================================================
 *  좌측 패널 — 생산 라인 진행률 / 작업 대기열 / 시뮬레이션 배속
 * =============================================================================
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity, FastForward, Gauge, GripVertical, Layers, Pause, Play, Plus, Save, Settings2, Trash2, Upload, X,
} from 'lucide-react';
import { completedEaAt } from '../../data/factoryAssets.js';
import { probabilityBefore, simulateLine } from '../../lib/lineSimulation.js';
import {
  SPEED_STEPS, fmtAnimScale, fmtClock, fmtDuration, fmtKoDuration, fmtSpeed, pad,
} from '../../lib/format.js';
import { AnimatedNumber, GhostButton, Modal, Panel, PanelTitle, StatusLamp } from '../ui.jsx';
import { fmtShiftRemain, shiftOf, shiftRemainSec } from '../../lib/shift.js';
import HandoverPanel from './HandoverPanel.jsx';
import SimResultDetail from '../sim/SimResultDetail.jsx';

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
 * 목표 납기 기본값·min 용 datetime-local 문자열 (로컬 시간대) —
 * toISOString() 은 UTC 로 밀려 한국에서 9시간 어긋난다.
 */
const fmtDatetimeLocal = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const LeftDashboardPanel = ({
  theme, mode, jobs, onRequestCancel, onOpenJobAdd, onOpenExcel,
  selectedJobId, onSelectJob, onReorderJobs, onApplyOrder, onSaveSnapshot,
  speed, onSpeedChange, currentJob, elapsed, now, taktSec, animTimeScale, eStopEngaged,
  todayQty = 0, cylinder, lineAssets, lineId,
  canManageJobs = true, manageHint,
  dailyTarget = 0, onSetDailyTarget,
  handoverNotes = [], onAddHandover, canWriteHandover = true, handoverHint,
  demoAutofill = true, onToggleAutofill,
  panelHidden = false, // 전체 관제 등으로 패널이 CSS hidden 일 때 — body 포털 모달까지 함께 숨긴다
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
  const [dueTarget, setDueTarget] = useState(''); // 목표 납기 'YYYY-MM-DDTHH:MM' (datetime-local)
  const [resultOpen, setResultOpen] = useState(false); // 결과 상세 모달
  const simCancelRef = useRef(null);
  const startLineSim = () => {
    setResultOpen(false);
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
        setDueTarget(fmtDatetimeLocal(new Date(Math.ceil((now + result.finishWallSec.p90 * 1000) / 60000) * 60000)));
        setResultOpen(true); // 완료 즉시 가운데 큰 팝업으로
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
    setResultOpen(false);
  };
  useEffect(() => () => {
    if (simCancelRef.current) {
      simCancelRef.current.cancelled = true;
      clearInterval(simCancelRef.current.timer);
    }
  }, []);
  /* 라인·모드를 전환하면 결과·모달·납기 목표를 지운다 — 패널이 key 없이 재사용되므로
     스테일 결과가 다른 라인 위에 뜨거나, 운전(1배속) 모드 위에 구배속으로 나눈 낙관적
     완료 시각·모달이 남는 것을 막는다 (실행 중이던 계산도 함께 취소). */
  useEffect(() => {
    if (simCancelRef.current) {
      simCancelRef.current.cancelled = true;
      clearInterval(simCancelRef.current.timer);
    }
    setLineSim(null);
    setResultOpen(false);
    setSavedAnchor(null);
    setDueTarget('');
  }, [lineId, mode]);

  /** 목표 납기(날짜+시각)를 앵커 기준 초로 바꿔 달성 확률을 계산한다.
   *  datetime-local 문자열은 로컬 시간대로 파싱된다. min 속성이 과거 선택을 막지만,
   *  직접 타이핑으로 과거가 들어오면 확률 0%로 정직하게 보여준다. */
  const dueProbabilityOf = (r) => {
    if (!dueTarget) return null;
    const target = new Date(dueTarget);
    if (Number.isNaN(target.getTime())) return null;
    return probabilityBefore(r.totalsWallSorted, (target.getTime() - r.anchorMs) / 1000);
  };

  return (
    /* lg 미만: 3D 아래 전폭 스택 (스크롤은 부모 컨테이너가 담당) */
    <aside className="w-[320px] shrink-0 h-full flex flex-col gap-3 p-3 overflow-y-auto
      max-lg:w-full max-lg:h-auto max-lg:overflow-visible max-lg:order-2">
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
                <span className={`inline-block w-2 h-2 rounded-full animate-pulse ${theme.accentBg}`} />
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
            const dueProb = dueProbabilityOf(r);
            const duePct = dueProb === null ? null : Math.round(dueProb * 100);
            const dueTone = duePct === null ? theme.textGhost
              : duePct >= 90 ? 'text-emerald-500' : duePct >= 50 ? 'text-amber-500' : 'text-red-500';
            return (
              <>
                {/* 패널에는 요점만 — 상세는 가운데 큰 팝업에서 */}
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
                  <button
                    type="button"
                    onClick={() => setResultOpen(true)}
                    className={`mt-2 w-full h-8 rounded-lg text-[11px] font-bold text-white transition
                      ${theme.accentBg} hover:opacity-90`}
                  >
                    결과 상세 보기
                  </button>
                  {savedAnchor === r.anchorMs && (
                    <p className="mt-1.5 text-center text-[10px] text-emerald-500">✓ 리포트에 저장됨</p>
                  )}
                </div>

                {/* 결과 상세 — 좌측 패널 조상의 필터/스크롤에 갇히지 않게 body 포털.
                    포털은 패널의 CSS hidden 을 탈출하므로 전체 관제 뷰에서는 직접 눌러 숨긴다 */}
                {resultOpen && !panelHidden && createPortal(
                  <Modal theme={theme} onClose={() => setResultOpen(false)} className="w-[900px] max-w-[94vw]">
                    <div className={`flex items-center justify-between px-4 py-3 border-b ${theme.panelBorder}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <Activity className={`w-4 h-4 shrink-0 ${theme.accentText}`} />
                        <h3 className={`text-sm font-bold truncate ${theme.textPrimary}`}>라인 시뮬레이션 결과</h3>
                        <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded border tabular-nums ${theme.chip}`}>
                          몬테카를로 {r.runs.toLocaleString()}회
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setResultOpen(false)}
                        className={`grid place-items-center w-7 h-7 rounded-md ${theme.textMuted} ${theme.hoverBg}`}
                        aria-label="닫기"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="p-4 max-h-[78vh] overflow-y-auto">
                      <SimResultDetail
                        theme={theme}
                        r={r}
                        dueSlot={
                          /* 목표 납기(날짜+시각) → 달성 확률 — min 으로 과거 선택 차단 */
                          <div className={`flex items-center flex-wrap gap-2 rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
                            <span className={`text-[10px] shrink-0 ${theme.textMuted}`}>목표 납기</span>
                            <input
                              type="datetime-local"
                              value={dueTarget}
                              min={fmtDatetimeLocal(new Date(r.anchorMs))}
                              onChange={(e) => setDueTarget(e.target.value)}
                              className={`h-6 px-1.5 rounded border text-[11px] tabular-nums ${theme.panelBorder} ${theme.inputBg} ${theme.textPrimary}
                                focus:outline-none focus:ring-2 ${theme.accentRing}`}
                            />
                            <span className={`ml-auto text-[12px] font-bold tabular-nums ${dueTone}`}>
                              {duePct === null ? '—' : `달성 확률 ${duePct}%`}
                            </span>
                          </div>
                        }
                        actionSlot={
                          <div className="space-y-2">
                            {/* 로트 순서 최적화 제안 — SPT (진행 중인 선두는 고정) */}
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
                          </div>
                        }
                      />
                    </div>
                  </Modal>,
                  document.body
                )}
              </>
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
