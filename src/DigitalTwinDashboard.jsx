/**
 * =============================================================================
 *  EGIS Factory - Digital Twin System (루트 컴포넌트)
 * =============================================================================
 *  Stack : React 19 / Vite / Tailwind v4 / lucide-react / react-three-fiber
 *
 *  [ 파일 구성 ]
 *   src/
 *    ├─ DigitalTwinDashboard.jsx      ← 이 파일 (전역 상태 + 레이아웃 조립)
 *    ├─ theme.js                      다크/라이트 × 운전/시뮬레이션 4조합 토큰
 *    ├─ scene/FactoryScene.jsx        3D 씬 (그리드 / OrbitControls / GLB / 픽킹)
 *    ├─ data/factoryAssets.js         설비 마스터 + 상태 정의
 *    ├─ data/jobs.js                  작업 초기 데이터 / 발번 / 단계 분류
 *    ├─ lib/format.js                 시간·숫자 포맷터
 *    ├─ lib/jobExcel.js               작업지시 엑셀 파싱/양식
 *    ├─ hooks/                        useWallClock / useLineJobTimers
 *    └─ components/
 *        ├─ ui.jsx                    Panel / StatusLamp / Modal 등 공용 프리미티브
 *        ├─ gnb/TopGnb.jsx
 *        ├─ left/LeftDashboardPanel.jsx
 *        ├─ view/TwinViewport.jsx
 *        ├─ right/AssetDetailSidebar.jsx
 *        └─ modals/                   JobAdd / ExcelUpload / Cctv / JobCancel / FaultAlarm / EStop
 * =============================================================================
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AlertOctagon } from 'lucide-react';

import {
  FAULT_SCENARIOS,
  PROCESS_CYCLE_SEC,
  PRODUCTION_LINES,
  SELECTABLE_ASSETS,
  findAsset,
} from './data/factoryAssets.js';
import {
  INITIAL_JOBS_BY_LINE,
  INITIAL_JOB_TEMPLATES,
  INITIAL_OFFSETS_BY_LINE,
  makeJobId,
  nextJobSeq,
} from './data/jobs.js';
import { getTheme } from './theme.js';
import { fmtAnimScale, fmtClock, fmtDate, fmtDuration, fmtSpeed } from './lib/format.js';
import { usePersistentState } from './lib/persist.js';
import { EVENT_LOG_LIMIT, makeEvent } from './lib/events.js';
import { useWallClock } from './hooks/useWallClock.js';
import { useProductionEngine } from './hooks/useProductionEngine.js';
import { useTelemetry } from './hooks/useTelemetry.js';

import TopGnb from './components/gnb/TopGnb.jsx';
import LeftDashboardPanel from './components/left/LeftDashboardPanel.jsx';
import TwinViewport from './components/view/TwinViewport.jsx';
import AssetDetailSidebar from './components/right/AssetDetailSidebar.jsx';
import JobAddModal from './components/modals/JobAddModal.jsx';
import ExcelUploadModal from './components/modals/ExcelUploadModal.jsx';
import CctvModal from './components/modals/CctvModal.jsx';
import JobCancelModal from './components/modals/JobCancelModal.jsx';
import FaultAlarmModal from './components/modals/FaultAlarmModal.jsx';
import EStopModal from './components/modals/EStopModal.jsx';
import ReportModal from './components/report/ReportModal.jsx';
import { clearAllPersisted } from './lib/persist.js';
import { PERMISSION_HINTS, ROLES, hasPermission } from './auth/auth.js';
import LoginScreen from './auth/LoginScreen.jsx';

/* 라인 목록은 3D 배치와 같은 소스를 쓴다 — factoryAssets.PRODUCTION_LINES */
const PLANTS = PRODUCTION_LINES;

/* 저장된 메모의 작성 시각(ISO 문자열)을 Date 로 되살린다 */
const reviveMemos = (stored) =>
  Object.fromEntries(
    Object.entries(stored ?? {}).map(([assetId, list]) => [
      assetId,
      (list ?? []).map((m) => ({ ...m, at: new Date(m.at) })),
    ])
  );

export default function DigitalTwinDashboard() {
  const [appearance, setAppearance] = usePersistentState('appearance', 'dark');
  /* 로그인 세션 — { id, name, role, at }. 없으면 로그인 화면만 보인다. */
  const [session, setSession] = usePersistentState('session', null);
  const [mode, setMode] = useState('operation');
  const [plant, setPlant] = useState(PLANTS[0].id);
  /* 대기열은 라인별로 완전히 분리된다. 작업 카탈로그(templates)만 라인 공용이다.
     대기열·카탈로그·배치·메모·이력은 localStorage 에 저장되어 새로고침에도 유지된다. */
  const [jobsByLine, setJobsByLine] = usePersistentState('jobsByLine', INITIAL_JOBS_BY_LINE);
  const [templates, setTemplates] = usePersistentState('templates', INITIAL_JOB_TEMPLATES);
  const [speed, setSpeed] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  /* 비상 정지는 라인 단위다 — 한 라인을 세워도 다른 라인은 계속 돈다 */
  const [eStopByLine, setEStopByLine] = useState(() =>
    Object.fromEntries(PLANTS.map((l) => [l.id, false]))
  );

  /* 대기열에서 선택한 작업 (취소 대상) */
  const [selectedJobId, setSelectedJobId] = useState(null);

  /**
   * 설비 오류 알람.
   *  alarm      — 발생한 오류 1건 { lineId, assetId, code, title, detail, at, acked }
   *  focusRequest — 3D 카메라가 찾아갈 대상. nonce 로 같은 설비 재요청도 구분한다.
   *  확인(acked) 전에는 비네팅이 깜빡이고 팝업이 떠 있다.
   */
  const [alarm, setAlarm] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);

  /* 모달 */
  const [jobCancelTarget, setJobCancelTarget] = useState(null);
  const [eStopModal, setEStopModal] = useState(false);
  const [jobAddModal, setJobAddModal] = useState(false);
  const [excelModal, setExcelModal] = useState(false);
  const [expandedCam, setExpandedCam] = useState(null);
  const [reportModal, setReportModal] = useState(false);

  /* 라인별 설비 배치 오프셋 / 설비별 메모(라인 공용 — 설비 마스터가 공용이라) */
  const [offsetsByLine, setOffsetsByLine] = usePersistentState('offsetsByLine', INITIAL_OFFSETS_BY_LINE);
  const [memos, setMemos] = usePersistentState('memos', {}, reviveMemos);

  /* 생산 실적(완료된 작업)·운영 이벤트 로그 — 리포트 화면의 데이터 소스 */
  const [production, setProduction] = usePersistentState('production', []);
  const [events, setEvents] = usePersistentState('events', []);

  const lineNameOf = (id) => PLANTS.find((p) => p.id === id)?.name ?? id;

  /* 이벤트에는 조작한 사용자를 함께 남긴다 (감사 로그) */
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const logEvent = useCallback(
    (type, message, extra) => {
      const ev = makeEvent(type, message, { user: sessionRef.current?.name, ...extra }); // 업데이터 밖에서 만든다 (StrictMode 이중 호출 안전)
      setEvents((prev) => [ev, ...prev].slice(0, EVENT_LOG_LIMIT));
    },
    [setEvents]
  );

  /* 권한 게이트 — 화면 전체가 이 헬퍼만 본다 */
  const can = (perm) => Boolean(session && hasPermission(session.role, perm));
  const handleLogin = (user) => {
    setSession({ id: user.id, name: user.name, role: user.role, at: new Date().toISOString() });
    const ev = makeEvent('LOGIN', `${user.name} (${ROLES[user.role].label}) 로그인`, { user: user.name });
    setEvents((prev) => [ev, ...prev].slice(0, EVENT_LOG_LIMIT));
  };
  const handleLogout = () => {
    logEvent('LOGOUT', `${session?.name} 로그아웃`);
    setSession(null);
  };

  /* 매초 시계 갱신으로 루트가 리렌더되므로, 씬의 memo 가 깨지지 않게 참조를 고정한다 */
  const theme = useMemo(() => getTheme(appearance, mode), [appearance, mode]);

  /* 화면에 보이는 것은 전부 '선택된 라인'의 상태다 */
  const jobs = jobsByLine[plant] ?? [];
  const offsets = offsetsByLine[plant] ?? {};
  const currentJob = jobs[0] ?? null;
  const selectedAsset = useMemo(() => findAsset(selectedId), [selectedId]);
  const plantName = PLANTS.find((p) => p.id === plant)?.name ?? '';

  /* 화면 곳곳(GNB 버튼·프레임·모달)이 보는 것은 '지금 선택된 라인'의 정지 여부 */
  const eStopEngaged = Boolean(eStopByLine[plant]);
  const stoppedLines = PLANTS.filter((l) => eStopByLine[l.id]);

  const now = useWallClock();

  /**
   * 작업 완료 — 엔진이 선두 작업의 표준시간을 다 채우면 호출한다.
   *  대기열을 전진시키고(다음 작업이 RUNNING 으로 올라온다) 생산 실적에 기록한다.
   */
  const handleJobComplete = useCallback(
    (lineId, job, { actualSec, defects }) => {
      setJobsByLine((prev) => {
        const queue = prev[lineId] ?? [];
        const rest = queue.slice(1).map((j, i) => (i === 0 ? { ...j, state: 'RUNNING' } : j));
        return { ...prev, [lineId]: rest };
      });
      const record = {
        id: `PR-${Date.now()}-${lineId}`,
        lineId,
        jobId: job.id,
        name: job.name,
        qty: job.qty,
        defects,
        plannedSec: job.totalSec,
        actualSec,
        finishedAt: new Date().toISOString(),
      };
      setProduction((prev) => [record, ...prev].slice(0, 500));
      logEvent('JOB_COMPLETED', `${job.name} · ${job.qty} EA 생산 완료 (실적 ${fmtDuration(actualSec)})`, {
        lineId,
        jobId: job.id,
      });
    },
    [setJobsByLine, setProduction, logEvent]
  );

  const { elapsedByLine, lineStats, resetElapsed, resetStats } = useProductionEngine({
    jobsByLine,
    speed: mode === 'simulation' ? speed : 1,
    pausedByLine: eStopByLine,
    onJobComplete: handleJobComplete,
  });
  const elapsed = elapsedByLine[plant] ?? 0;

  /**
   * 3D 애니메이션 배속 연동 — 라인별로 계산한다.
   *  GLB 의 "TOTAL" 클립 1회(7.2s)가 곧 제품 1개를 흘려보내는 1사이클이다.
   *  각 라인의 선두 작업 택트타임(표준시간 ÷ 수량)만큼 걸리도록 재생 속도를 맞추면,
   *  화면 속 설비 동작 주기가 그 라인의 실제 생산 리듬과 같아진다.
   *    timeScale = 클립길이 / 택트타임 × (시뮬레이션 배속)
   *  엑셀 업로드로 택트가 극단적인 작업이 들어와도 눈으로 볼 수 있게 비율을 제한한다.
   *  비상 정지된 라인은 paused 로 그 자리에 멈춘다.
   */
  const taktOf = (job) =>
    job && job.qty > 0 ? job.totalSec / job.qty : PROCESS_CYCLE_SEC;
  const scaleOf = (takt) =>
    Math.min(4, Math.max(0.1, PROCESS_CYCLE_SEC / takt)) * (mode === 'simulation' ? speed : 1);

  /* 대기열이 빈 라인은 설비도 멈춘다 — 지시 없는 라인이 도는 건 부자연스럽다 */
  const animByLine = useMemo(
    () =>
      Object.fromEntries(
        PLANTS.map((line) => [
          line.id,
          {
            timeScale: scaleOf(taktOf(jobsByLine[line.id]?.[0] ?? null)),
            paused: Boolean(eStopByLine[line.id]) || (jobsByLine[line.id]?.length ?? 0) === 0,
          },
        ])
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobsByLine, eStopByLine, mode, speed]
  );

  /* 좌측 패널·HUD·푸터에 숫자로 보여주는 값은 선택된 라인 기준 */
  const taktSec = taktOf(currentJob);
  const animTimeScale = animByLine[plant]?.timeScale ?? 1;

  /* 오류가 걸린 설비 — 3D 하이라이트와 상세 패널이 같은 소스를 본다 */
  const faults = useMemo(
    () => (alarm ? { [alarm.lineId]: alarm.assetId } : {}),
    [alarm]
  );

  /* 텔레메트리 — 정지(E-STOP)·유휴(대기열 없음) 라인은 센서값이 식는다 */
  const telemetryStopped = useMemo(
    () =>
      Object.fromEntries(
        PLANTS.map((l) => [
          l.id,
          Boolean(eStopByLine[l.id]) || (jobsByLine[l.id]?.length ?? 0) === 0,
        ])
      ),
    [eStopByLine, jobsByLine]
  );
  const telemetry = useTelemetry({ stoppedByLine: telemetryStopped, faults });
  const selectedAssetFault =
    alarm && alarm.lineId === plant && alarm.assetId === selectedId ? alarm : null;

  /**
   * 오류 상황 테스트 — 무작위 라인 · 무작위 시나리오로 알람을 발생시킨다.
   * 이미 발생한 오류가 있으면 해제 버튼으로 동작한다.
   */
  const handleFaultTest = () => {
    if (alarm) {
      logEvent('ALARM_CLEARED', `[${alarm.code}] ${alarm.title} 해제`, {
        lineId: alarm.lineId,
        assetId: alarm.assetId,
      });
      setAlarm(null);
      return;
    }
    const scenario = FAULT_SCENARIOS[Math.floor(Math.random() * FAULT_SCENARIOS.length)];
    const line = PLANTS[Math.floor(Math.random() * PLANTS.length)];
    setAlarm({ ...scenario, lineId: line.id, at: new Date(), acked: false });
    logEvent('ALARM_RAISED', `[${scenario.code}] ${scenario.title}`, {
      lineId: line.id,
      assetId: scenario.assetId,
    });
  };

  /** 알람 확인 — 비네팅을 멈추고, 해당 라인으로 전환한 뒤 그 설비를 선택·줌인한다 */
  const handleGoToFault = () => {
    if (!alarm) return;
    setAlarm((prev) => ({ ...prev, acked: true }));
    setPlant(alarm.lineId);
    setSelectedJobId(null);
    setSelectedId(alarm.assetId);
    setFocusRequest({ assetId: alarm.assetId, nonce: Date.now() });
    logEvent('ALARM_ACKED', `[${alarm.code}] ${alarm.title} 확인`, {
      lineId: alarm.lineId,
      assetId: alarm.assetId,
    });
  };

  /** 비상 정지 — 지금 선택된 라인만 세우거나 해제한다 */
  const handleEStopToggle = () => {
    const engaging = !eStopByLine[plant];
    setEStopByLine((prev) => ({ ...prev, [plant]: engaging }));
    logEvent(engaging ? 'ESTOP_ON' : 'ESTOP_OFF', `${lineNameOf(plant)} ${engaging ? '비상 정지' : '비상 정지 해제'}`, {
      lineId: plant,
    });
  };

  /* 라인을 바꾸면 이전 라인을 가리키던 선택은 전부 버린다 (설비도 대기열 작업도) */
  const handlePlantChange = (next) => {
    setPlant(next);
    setSelectedId(null);
    setSelectedJobId(null);
  };

  const handleModeChange = (next) => {
    setMode(next);
    if (next === 'operation') setSpeed(1);
  };

  /**
   * 3D 기즈모 드래그가 끝날 때 한 번 호출된다.
   * 조작 가능한 것은 선택된 라인뿐이므로 그 라인의 배치에만 기록한다.
   * (씬 memo 유지를 위해 참조 고정 — plant 가 바뀔 때만 새로 만든다)
   */
  const handleMove = useCallback(
    (id, position) => {
      setOffsetsByLine((prev) => ({
        ...prev,
        [plant]: { ...prev[plant], [id]: position },
      }));
      logEvent('LAYOUT_MOVED', `${findAsset(id)?.name ?? id} 위치 조정 [${position.join(', ')}]`, {
        lineId: plant,
        assetId: id,
      });
    },
    [plant, setOffsetsByLine, logEvent]
  );

  const handleOffsetReset = (id) =>
    setOffsetsByLine((prev) => ({
      ...prev,
      [plant]: { ...prev[plant], [id]: [...(findAsset(id)?.offset ?? [0, 0, 0])] },
    }));

  /** 선택된 라인의 대기열만 갈아끼운다 — 다른 라인은 건드리지 않는다 */
  const updateLineJobs = (updater) =>
    setJobsByLine((prev) => ({ ...prev, [plant]: updater(prev[plant] ?? []) }));

  /* 확인 팝업에서 '작업 취소'를 누른 뒤에만 실제로 제거된다 */
  const handleCancelJob = (id) => {
    const cancelled = jobs.find((j) => j.id === id);
    const wasHead = currentJob?.id === id;
    updateLineJobs((prev) => {
      const rest = prev.filter((j) => j.id !== id);
      /* 선두를 취소했으면 다음 작업이 곧바로 올라온다 — 진행 시간도 0 부터 */
      return wasHead ? rest.map((j, i) => (i === 0 ? { ...j, state: 'RUNNING' } : j)) : rest;
    });
    if (wasHead) resetElapsed(plant);
    setSelectedJobId((cur) => (cur === id ? null : cur));
    setJobCancelTarget(null);
    if (cancelled) {
      logEvent('JOB_CANCELLED', `${cancelled.name} (${cancelled.id}) 취소`, { lineId: plant });
    }
  };

  const handleAddMemo = (assetId, text) => {
    const memo = { id: Date.now(), at: new Date(), text, author: session?.name };
    setMemos((prev) => ({
      ...prev,
      [assetId]: [memo, ...(prev[assetId] ?? [])],
    }));
    logEvent('MEMO_ADDED', `${findAsset(assetId)?.name ?? assetId} 메모 작성`, { assetId });
  };

  /** 엑셀에서 선택된 행들을 '선택된 라인' 대기열에 추가하고, 카탈로그에도 없으면 등록한다 */
  const handleImportExcel = (rows) => {
    logEvent('JOB_IMPORTED', `엑셀 업로드로 작업 ${rows.length}건 추가`, { lineId: plant });
    updateLineJobs((prev) => [
      ...prev,
      ...rows.map((r, i) => ({
        id: makeJobId(nextJobSeq(prev) + i),
        name: r.name,
        qty: r.qty,
        totalSec: r.totalSec,
        state: 'IDLE',
      })),
    ]);
    setTemplates((prev) => {
      const known = new Set(prev.map((t) => t.name));
      const added = rows
        .filter((r) => !known.has(r.name))
        .map((r, i) => ({
          id: `TPL-${String(prev.length + i + 1).padStart(2, '0')}`,
          name: r.name,
          qty: r.qty,
          totalSec: r.totalSec,
        }));
      return [...prev, ...added];
    });
  };

  const handleAddJob = (tpl, qty) => {
    updateLineJobs((prev) => [
      ...prev,
      {
        id: makeJobId(nextJobSeq(prev)),
        name: tpl.name,
        qty,
        /* 표준시간은 '기본 수량 기준'이라 수량을 바꾸면 비례해 늘린다 */
        totalSec: tpl.qty > 0 ? Math.round(tpl.totalSec * (qty / tpl.qty)) : tpl.totalSec,
        state: 'IDLE',
      },
    ]);
    logEvent('JOB_ADDED', `${tpl.name} · ${qty} EA 대기열 추가`, { lineId: plant });
  };

  /* 로그인 전에는 대시보드 대신 로그인 화면만 보여준다.
     (엔진·텔레메트리 훅은 계속 돌므로 공장은 뒤에서 계속 가동된다) */
  if (!session) {
    return <LoginScreen theme={theme} onLogin={handleLogin} />;
  }

  return (
    <div className={`w-screen h-screen overflow-hidden flex flex-col font-sans ${theme.appBg} ${theme.textSecondary} transition-colors duration-300`}>
      {/* 시뮬레이션 / E-STOP 전역 프레임 */}
      <div
        className={`pointer-events-none fixed inset-0 z-40 ring-2 ring-inset transition-all duration-500
          ${eStopEngaged ? 'ring-red-500/70' : theme.frameRing}`}
      />

      {/* 설비 오류 경광등 — 확인(설비로 이동) 전까지 깜빡인다 */}
      {alarm && !alarm.acked && (
        <div className="alarm-vignette pointer-events-none fixed inset-0 z-40" aria-hidden />
      )}

      <TopGnb
        theme={theme}
        mode={mode}
        onModeChange={handleModeChange}
        plant={plant}
        onPlantChange={handlePlantChange}
        eStopEngaged={eStopEngaged}
        onEStop={() => setEStopModal(true)}
        eStopAllowed={eStopEngaged ? can('estop.release') : can('estop.engage')}
        eStopHint={PERMISSION_HINTS['estop.release']}
        now={now}
        simElapsed={elapsed}
        speed={speed}
        appearance={appearance}
        onToggleAppearance={() => setAppearance((a) => (a === 'dark' ? 'light' : 'dark'))}
        faultActive={Boolean(alarm)}
        onFaultTest={handleFaultTest}
        faultTestAllowed={can('fault.test')}
        faultTestHint={PERMISSION_HINTS['fault.test']}
        onOpenReport={() => setReportModal(true)}
        user={session}
        onLogout={handleLogout}
      />

      <div className="relative flex-1 min-h-0 flex">
        <LeftDashboardPanel
          theme={theme}
          mode={mode}
          jobs={jobs}
          onRequestCancel={setJobCancelTarget}
          selectedJobId={selectedJobId}
          onSelectJob={setSelectedJobId}
          onOpenJobAdd={() => setJobAddModal(true)}
          onOpenExcel={() => setExcelModal(true)}
          speed={speed}
          onSpeedChange={setSpeed}
          currentJob={currentJob}
          elapsed={elapsed}
          now={now}
          taktSec={taktSec}
          animTimeScale={animTimeScale}
          eStopEngaged={eStopEngaged}
          canManageJobs={can('jobs.manage')}
          manageHint={PERMISSION_HINTS['jobs.manage']}
        />

        <TwinViewport
          theme={theme}
          mode={mode}
          selectedId={selectedId}
          selectedAsset={selectedAsset}
          onSelect={setSelectedId}
          offsets={offsets}
          offsetsByLine={offsetsByLine}
          onMove={handleMove}
          onOffsetReset={handleOffsetReset}
          now={now}
          simElapsed={elapsed}
          speed={speed}
          onExpandCam={setExpandedCam}
          animTimeScale={animTimeScale}
          animByLine={animByLine}
          animPaused={eStopEngaged}
          activeLineId={plant}
          faults={faults}
          focusRequest={focusRequest}
          canAdjustLayout={can('layout.adjust')}
        />

        <AssetDetailSidebar
          theme={theme}
          mode={mode}
          asset={selectedAsset}
          fault={selectedAssetFault}
          lineStopped={eStopEngaged}
          onClose={() => setSelectedId(null)}
          now={now}
          memos={memos[selectedId] ?? []}
          onAddMemo={handleAddMemo}
          memoAuthor={session.name}
          canWriteMemo={can('memo.write')}
          memoHint={PERMISSION_HINTS['memo.write']}
          lineId={plant}
          telemetry={telemetry}
        />
      </div>

      {/* 하단 스테이터스 바 */}
      <footer
        className={`h-7 shrink-0 flex items-center justify-between px-4 border-t ${theme.panelBorder}
          ${theme.headerBg} text-[10px] tabular-nums ${theme.textFaint}`}
      >
        <div className="flex items-center gap-4">
          {/* 데이터 소스 상태 — 시뮬레이션/실계측을 정직하게 표시한다 */}
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {telemetry.sourceInfo.label} 연결됨
          </span>
          <span>Latency {telemetry.latencyMs ?? '--'}ms</span>
          <span>Sync {fmtDate(now)} {fmtClock(now)}</span>
          {/* 비상 정지가 라인 단위라, 보고 있지 않은 라인이 멈춰 있어도 알 수 있어야 한다 */}
          {stoppedLines.length > 0 && (
            <span className="flex items-center gap-1.5 font-semibold text-red-500">
              <AlertOctagon className="w-3 h-3" />
              E-STOP {stoppedLines.map((l) => l.name.replace('DM뷰 - ', '')).join(' · ')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span>선택 가능 설비 {SELECTABLE_ASSETS.length}대</span>
          <span>{mode === 'simulation' ? `SIM ${fmtSpeed(speed)}x` : 'REALTIME 1.0x'}</span>
          <span>{eStopEngaged ? '3D 정지' : `3D ×${fmtAnimScale(animTimeScale)}`}</span>
          <span>{plantName}</span>
        </div>
      </footer>

      {/* 설비 오류 알람 — 확인 전까지 최상단에 떠 있는다 */}
      {alarm && !alarm.acked && (
        <FaultAlarmModal
          theme={theme}
          alarm={alarm}
          lineName={PLANTS.find((p) => p.id === alarm.lineId)?.name ?? alarm.lineId}
          asset={findAsset(alarm.assetId)}
          onGoTo={handleGoToFault}
        />
      )}

      {jobCancelTarget && (
        <JobCancelModal
          theme={theme}
          job={jobCancelTarget}
          isCurrent={jobCancelTarget.id === currentJob?.id}
          onCancel={() => setJobCancelTarget(null)}
          onConfirm={() => handleCancelJob(jobCancelTarget.id)}
        />
      )}

      {eStopModal && (
        <EStopModal
          theme={theme}
          engaged={eStopEngaged}
          plantName={plantName}
          onCancel={() => setEStopModal(false)}
          onConfirm={() => { handleEStopToggle(); setEStopModal(false); }}
        />
      )}

      {jobAddModal && (
        <JobAddModal
          theme={theme}
          templates={templates}
          onAddTemplate={(tpl) => setTemplates((prev) => [...prev, tpl])}
          onAddJob={handleAddJob}
          onClose={() => setJobAddModal(false)}
        />
      )}

      {excelModal && (
        <ExcelUploadModal
          theme={theme}
          existingNames={jobs.map((j) => j.name)}
          onImport={handleImportExcel}
          onClose={() => setExcelModal(false)}
        />
      )}

      {expandedCam && (
        <CctvModal theme={theme} cam={expandedCam} now={now} onClose={() => setExpandedCam(null)} />
      )}

      {reportModal && (
        <ReportModal
          theme={theme}
          production={production}
          events={events}
          lineStats={lineStats}
          canExport={can('report.export')}
          exportHint={PERMISSION_HINTS['report.export']}
          canReset={can('data.reset')}
          resetHint={PERMISSION_HINTS['data.reset']}
          onClose={() => setReportModal(false)}
          onResetData={() => {
            /* 데모 초기화 — 저장 데이터를 비우고 초기 상태로 재시작한다 */
            clearAllPersisted();
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
