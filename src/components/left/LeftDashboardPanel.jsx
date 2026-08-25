/**
 * =============================================================================
 *  좌측 패널 — 생산 라인 진행률 / 작업 대기열 / 시뮬레이션 배속
 * =============================================================================
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, FastForward, Gauge, GripVertical, Layers, Pause, Play, Plus, Settings2, Trash2, Upload, X,
} from 'lucide-react';
import {
  SPEED_STEPS, fmtAnimScale, fmtClock, fmtDuration, fmtKoDuration, fmtSpeed, pad,
} from '../../lib/format.js';
import { GhostButton, Panel, PanelTitle, StatusLamp } from '../ui.jsx';

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

const LeftDashboardPanel = ({
  theme, mode, jobs, onRequestCancel, onOpenJobAdd, onOpenExcel,
  selectedJobId, onSelectJob, onReorderJobs,
  speed, onSpeedChange, currentJob, elapsed, now, taktSec, animTimeScale, eStopEngaged,
  todayQty = 0, cylinder,
  canManageJobs = true, manageHint,
}) => {
  const progress = currentJob ? Math.min(100, (elapsed / currentJob.totalSec) * 100) : 0;
  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;
  const targetQty = jobs.reduce((sum, j) => sum + j.qty, 0);
  const doneQty = currentJob ? Math.round(currentJob.qty * (progress / 100)) : 0;

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
   * 라인 시뮬레이션 — 대기열 전체를 현재 배속으로 돌렸을 때의 완료 예측.
   *  실제 라인 상태는 건드리지 않는 예측 도구다. 몇 초 진행 후 결과 카드가 나온다.
   */
  const [lineSim, setLineSim] = useState(null); // null | {progress} | {done, result}
  const lineSimTimer = useRef(null);
  const startLineSim = () => {
    clearInterval(lineSimTimer.current);
    const DURATION_MS = 3000;
    const t0 = Date.now();
    const lots = jobs.length;
    const totalQty = jobs.reduce((s, j) => s + j.qty, 0);
    const standardSec = jobs.reduce((s, j) => s + j.totalSec, 0);
    const remainSec = Math.max(0, standardSec - elapsed);
    const speedNow = simSpeed;
    setLineSim({ progress: 0 });
    lineSimTimer.current = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / DURATION_MS);
      if (k >= 1) {
        clearInterval(lineSimTimer.current);
        setLineSim({
          done: true,
          result: {
            lots,
            totalQty,
            defects: Math.round(totalQty * Math.random() * 0.015),
            standardSec,
            wallSec: remainSec / speedNow,
            finishAt: new Date(Date.now() + (remainSec / speedNow) * 1000),
            speed: speedNow,
          },
        });
      } else {
        setLineSim({ progress: k });
      }
    }, 80);
  };
  const stopLineSim = () => {
    clearInterval(lineSimTimer.current);
    setLineSim(null);
  };
  useEffect(() => () => clearInterval(lineSimTimer.current), []);

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
              <span className={`text-[10px] px-2 py-0.5 rounded border ${theme.chip}`}>DAY SHIFT</span>
            )
          }
        />
        <div className="p-3 space-y-3">
          <div className="flex items-end justify-between">
            <div className="min-w-0">
              <p className={`text-3xl font-bold tabular-nums leading-none ${theme.textPrimary}`}>
                {progress.toFixed(0)}<span className={`text-base ml-0.5 ${theme.textMuted}`}>%</span>
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
              ['대기 물량', `${targetQty}`],
              ['진행', `${doneQty}`],
              /* 완료 작업의 누적 — 작업이 끝날 때마다 점프해서 배속 효과가 눈에 띈다 */
              ['금일 생산', `${todayQty}`],
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
          hint="작업지시는 로트(품목+수량) 단위입니다. 맨 위 로트가 지금 라인을 흐르고 있고, 행을 드래그해 생산 순서를 바꿀 수 있습니다."
          right={<span className={`text-[10px] tabular-nums ${theme.textFaint}`}>{jobs.length} LOTS</span>}
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

      {/* 라인 시뮬레이션 ------------------------------------------ */}
      <Panel theme={theme} data-tour="line-sim" className={mode === 'simulation' ? theme.glow : ''}>
        <PanelTitle
          icon={Activity}
          title="라인 시뮬레이션"
          theme={theme}
          hint="대기열의 모든 로트를 현재 배속으로 돌렸을 때의 완료 시각·생산량·예상 불량을 미리 계산합니다. 실제 라인 상태에는 영향이 없습니다."
          right={
            <span className={`text-[10px] px-2 py-0.5 rounded border ${theme.chip}`}>
              {mode === 'simulation' ? 'READY' : 'LIVE 잠금'}
            </span>
          }
        />
        <div className="p-3 space-y-2.5">
          <p className={`text-[10px] tabular-nums ${theme.textFaint}`}>
            대기열 로트 {jobs.length}건 · 총 {jobs.reduce((s, j) => s + j.qty, 0)} EA · 표준{' '}
            {fmtKoDuration(jobs.reduce((s, j) => s + j.totalSec, 0))}
          </p>

          {lineSim && !lineSim.done && (
            <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
              <div className="flex items-center justify-between text-[11px]">
                <span className={theme.textMuted}>가상 실행 중…</span>
                <span className={`font-bold tabular-nums ${theme.accentText}`}>
                  {Math.round(lineSim.progress * 100)}%
                </span>
              </div>
              <div className={`mt-1.5 h-1.5 rounded-full overflow-hidden ${theme.trackBg}`}>
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${theme.barFrom} ${theme.barTo}`}
                  style={{ width: `${lineSim.progress * 100}%` }}
                />
              </div>
            </div>
          )}

          {lineSim?.done && (
            <div className={`rounded-lg border ${theme.panelBorder} ${theme.accentBgSoft} px-3 py-2.5`}>
              <p className={`text-[11px] font-bold ${theme.accentText}`}>가상 실행 결과 (예측)</p>
              <dl className="mt-1.5 grid grid-cols-3 gap-1.5 text-center">
                {[
                  ['총 생산량', `${lineSim.result.totalQty} EA`],
                  ['예상 불량', `${lineSim.result.defects} EA`],
                  ['완료 예정', fmtClock(lineSim.result.finishAt, false)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className={`text-[10px] ${theme.textFaint}`}>{k}</dt>
                    <dd className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.textSecondary}`}>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className={`mt-1.5 text-[10px] tabular-nums ${theme.textGhost}`}>
                로트 {lineSim.result.lots}건 · 표준 {fmtKoDuration(lineSim.result.standardSec)} ·
                ×{fmtSpeed(lineSim.result.speed)} 배속 기준 약 {fmtKoDuration(lineSim.result.wallSec)} 소요
              </p>
            </div>
          )}

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
    </aside>
  );
};

export default LeftDashboardPanel;
