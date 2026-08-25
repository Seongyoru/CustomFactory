/**
 * =============================================================================
 *  좌측 패널 — 생산 라인 진행률 / 작업 대기열 / 시뮬레이션 배속
 * =============================================================================
 */
import React, { useMemo, useRef, useState } from 'react';
import { FastForward, Gauge, GripVertical, Layers, Plus, Settings2, Trash2, Upload, X } from 'lucide-react';
import { pipelineProgress } from '../../data/jobs.js';
import {
  SPEED_STEPS, fmtAnimScale, fmtClock, fmtDuration, fmtSpeed, pad,
} from '../../lib/format.js';
import { GhostButton, Panel, PanelTitle, StatusLamp } from '../ui.jsx';

const LeftDashboardPanel = ({
  theme, mode, jobs, onRequestCancel, onOpenJobAdd, onOpenExcel,
  selectedJobId, onSelectJob, onReorderJobs,
  speed, onSpeedChange, currentJob, elapsed, now, taktSec, animTimeScale, eStopEngaged,
  todayQty = 0,
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
   * 파이프라인 단계 진행률 — 현재 로트가 개포장→이송→충전→검사를 통과하는 현황.
   *  각 EA 는 단계를 순서대로 지나가고 단계 사이에 1사이클 지연이 있으므로,
   *  앞 단계 완료 수 ≥ 뒷 단계 완료 수가 항상 성립한다(둘의 차이가 재공품).
   */
  const stages = useMemo(() => pipelineProgress(currentJob, elapsed), [currentJob, elapsed]);

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

          {/* 파이프라인 — 각 EA 가 단계를 순서대로 지나간다. 숫자는 그 단계를 마친 EA */}
          <ul className="space-y-2 pt-1">
            {stages.map((s, i) => (
              <li
                key={s.name}
                className="flex items-center gap-2"
                title={s.done === null
                  ? `${s.name} · 진행 중인 로트 없음`
                  : `${s.name} · ${s.done} EA 완료${i > 0 && stages[i - 1].done > s.done ? ` · 재공 ${stages[i - 1].done - s.done} EA` : ''}`}
              >
                <span className={`w-11 text-[11px] shrink-0 ${s.done !== null ? theme.textMuted : theme.textGhost}`}>
                  {s.name}
                </span>
                <span className={`flex-1 h-1.5 rounded-full overflow-hidden ${theme.trackBg}`}>
                  <span
                    className={`block h-full rounded-full bg-gradient-to-r ${theme.barFrom} ${theme.barTo}`}
                    style={{ width: `${s.value ?? 0}%`, transition: 'width 900ms linear' }}
                  />
                </span>
                <span className={`w-14 text-right text-[11px] tabular-nums ${s.done === null ? theme.textGhost : theme.textSecondary}`}>
                  {s.done === null ? '—' : `${s.done} EA`}
                </span>
              </li>
            ))}
          </ul>
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
    </aside>
  );
};

export default LeftDashboardPanel;
