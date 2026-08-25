/**
 * =============================================================================
 *  좌측 패널 — 생산 라인 진행률 / 작업 대기열 / 시뮬레이션 배속
 * =============================================================================
 */
import React, { useMemo } from 'react';
import { Gauge, GripVertical, Layers, Plus, Settings2, Trash2, Upload, X } from 'lucide-react';
import { STAGE_ORDER, stageOf } from '../../data/jobs.js';
import {
  SPEED_STEPS, fmtAnimScale, fmtClock, fmtDuration, fmtSpeed, pad,
} from '../../lib/format.js';
import { GhostButton, Panel, PanelTitle, StatusLamp } from '../ui.jsx';

const LeftDashboardPanel = ({
  theme, mode, jobs, onRequestCancel, onOpenJobAdd, onOpenExcel,
  selectedJobId, onSelectJob,
  speed, onSpeedChange, currentJob, elapsed, now, taktSec, animTimeScale, eStopEngaged,
  canManageJobs = true, manageHint,
}) => {
  const progress = currentJob ? Math.min(100, (elapsed / currentJob.totalSec) * 100) : 0;
  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;
  const targetQty = jobs.reduce((sum, j) => sum + j.qty, 0);
  const doneQty = currentJob ? Math.round(currentJob.qty * (progress / 100)) : 0;

  const finishAt = useMemo(() => {
    if (!currentJob) return '--:--';
    const remain = (currentJob.totalSec - elapsed) / speed;
    return fmtClock(new Date(now.getTime() + remain * 1000), false);
  }, [currentJob, elapsed, speed, now]);

  /**
   * 단계별 진행률 — 대기열에서 실제로 계산한다.
   *  분모: 그 단계에 배정된 대기열 작업들의 표준시간 합.
   *  분자: 라인 경과시간을 그 단계 물량에 순서대로 채운 값.
   *
   *  4개 단계는 순차가 아니라 동시에 돈다(3D 에서도 컨베이어·절단·카트·충전이
   *  한 사이클 안에서 함께 움직인다). 그래서 선두 작업의 단계만 움직이게 하지 않고
   *  같은 라인 시계를 네 단계에 모두 적용한다.
   *  결과적으로 물량이 적은 단계는 빨리 차고, 작업을 추가하면 분모가 늘어 값이 내려간다.
   *  작업이 하나도 없는 단계는 '—' 로 비워 둔다.
   */
  const stages = useMemo(() => {
    const acc = Object.fromEntries(STAGE_ORDER.map((s) => [s, { total: 0, count: 0 }]));
    jobs.forEach((job) => {
      const stage = stageOf(job.name);
      if (!stage) return;
      acc[stage].total += job.totalSec;
      acc[stage].count += 1;
    });
    return STAGE_ORDER.map((name) => {
      const { total, count } = acc[name];
      return {
        name,
        count,
        totalSec: total,
        value: total > 0 ? Math.min(100, (Math.min(elapsed, total) / total) * 100) : null,
      };
    });
  }, [jobs, elapsed]);

  return (
    <aside className="w-[320px] shrink-0 h-full flex flex-col gap-3 p-3 overflow-y-auto">
      {/* 작업 진행률 --------------------------------------------- */}
      <Panel theme={theme} className={theme.glow}>
        <PanelTitle
          icon={Gauge}
          title="생산 라인 진행률"
          theme={theme}
          right={<span className={`text-[10px] px-2 py-0.5 rounded border ${theme.chip}`}>DAY SHIFT</span>}
        />
        <div className="p-3 space-y-3">
          <div className="flex items-end justify-between">
            <div className="min-w-0">
              <p className={`text-3xl font-bold tabular-nums leading-none ${theme.textPrimary}`}>
                {progress.toFixed(0)}<span className={`text-base ml-0.5 ${theme.textMuted}`}>%</span>
              </p>
              <p className={`mt-1 truncate text-[11px] ${theme.textFaint}`}>
                현재 작업 · {currentJob?.name ?? '-'}
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

          <div className={`grid grid-cols-3 gap-2 rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2 text-center`}>
            {[['목표', `${targetQty} EA`], ['실적', `${doneQty} EA`], ['완료 예정', finishAt]].map(([k, v]) => (
              <div key={k}>
                <p className={`text-[10px] ${theme.textFaint}`}>{k}</p>
                <p className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.textSecondary}`}>{v}</p>
              </div>
            ))}
          </div>

          <ul className="space-y-2 pt-1">
            {stages.map((s) => (
              <li
                key={s.name}
                className="flex items-center gap-2"
                title={s.count > 0
                  ? `${s.name} · 작업 ${s.count}건 · 총 표준시간 ${fmtDuration(s.totalSec)}`
                  : `${s.name} · 대기열에 작업 없음`}
              >
                <span className={`w-11 text-[11px] shrink-0 ${s.count > 0 ? theme.textMuted : theme.textGhost}`}>
                  {s.name}
                </span>
                <span className={`flex-1 h-1.5 rounded-full overflow-hidden ${theme.trackBg}`}>
                  <span
                    className={`block h-full rounded-full bg-gradient-to-r ${theme.barFrom} ${theme.barTo}`}
                    style={{ width: `${s.value ?? 0}%`, transition: 'width 900ms linear' }}
                  />
                </span>
                <span className={`w-9 text-right text-[11px] tabular-nums ${s.value === null ? theme.textGhost : theme.textSecondary}`}>
                  {s.value === null ? '—' : `${Math.round(s.value)}%`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      {/* 작업 대기열 --------------------------------------------- */}
      <Panel theme={theme} className="flex-1 min-h-[220px] flex flex-col">
        <PanelTitle
          icon={Layers}
          title="작업 대기열"
          theme={theme}
          right={<span className={`text-[10px] tabular-nums ${theme.textFaint}`}>{jobs.length} JOBS</span>}
        />

        <ul className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {jobs.map((job, idx) => {
            const picked = job.id === selectedJobId;
            return (
            <li
              key={job.id}
              onClick={() => onSelectJob(picked ? null : job.id)}
              aria-selected={picked}
              className={`group flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors cursor-pointer
                ${idx === 0 ? `${theme.accentBgSoft} ${theme.panelBorder}` : `${theme.panelBorder} ${theme.cardBg} ${theme.hoverBg}`}`}
              style={picked ? { borderColor: theme.accentHex, boxShadow: `inset 0 0 0 1px ${theme.accentHex}` } : undefined}
            >
              <GripVertical className={`w-3.5 h-3.5 shrink-0 ${theme.textGhost}`} />
              <span className={`w-5 text-[10px] tabular-nums ${theme.textGhost}`}>{pad(idx + 1)}</span>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[12px] font-medium ${theme.textSecondary}`}>{job.name}</p>
                <p className={`text-[10px] tabular-nums ${theme.textFaint}`}>
                  {job.id} · {job.qty} EA · 표준 {fmtDuration(job.totalSec)}
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
            작업 추가
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
      <Panel theme={theme}>
        <PanelTitle
          icon={Settings2}
          title="시뮬레이션 배속"
          theme={theme}
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

          {/* 3D 애니메이션 연동 상태 — 택트타임이 곧 재생 속도다 */}
          <div className={`mt-2.5 grid grid-cols-2 gap-2 rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2 text-center`}>
            <div>
              <p className={`text-[10px] ${theme.textFaint}`}>택트타임</p>
              <p className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.textSecondary}`}>
                {taktSec.toFixed(1)} s/EA
              </p>
            </div>
            <div>
              <p className={`text-[10px] ${theme.textFaint}`}>3D 재생 배속</p>
              <p className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.accentText}`}>
                ×{fmtAnimScale(animTimeScale)}
              </p>
            </div>
          </div>

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
