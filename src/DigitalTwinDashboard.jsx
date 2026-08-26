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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertOctagon } from 'lucide-react';

import {
  CLIP_FPS,
  CONVEYOR_LOAD_MAX,
  FAULT_SCENARIOS,
  PRODUCTION_LINES,
  REPEAT_PERIOD_F,
  SELECTABLE_ASSETS,
  completedEaAt,
  currentLoadAt,
  findAsset,
} from './data/factoryAssets.js';
import { findLineAsset, lineSelectableAssets, memoKeyOf } from './data/lineAssets.js';
import {
  INITIAL_JOBS_BY_LINE,
  INITIAL_OFFSETS_BY_LINE,
  INITIAL_PRODUCT_CATALOG,
  computeCylinder,
  makeLot,
  makeLotId,
  nextLotSeq,
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
import SourceSettingsModal from './components/modals/SourceSettingsModal.jsx';
import { clearAllPersisted } from './lib/persist.js';
import { PERMISSION_HINTS, ROLES, hasPermission } from './auth/auth.js';
import LoginScreen from './auth/LoginScreen.jsx';
import TutorialOverlay from './components/TutorialOverlay.jsx';

/* 라인 목록은 3D 배치와 같은 소스를 쓴다 — factoryAssets.PRODUCTION_LINES */
const PLANTS = PRODUCTION_LINES;

/**
 * 저장된 메모의 작성 시각(ISO 문자열)을 Date 로 되살린다.
 *  키는 `라인:설비` (memoKeyOf) — 설비 마스터가 라인 공용이던 시절의 구키(설비 ID만)는
 *  1호기 기록으로 옮긴다 (당시 화면이 사실상 1호기 값을 보여주고 있었다).
 */
const reviveMemos = (stored) => {
  const out = {};
  for (const [key, list] of Object.entries(stored ?? {})) {
    const k = key.includes(':') ? key : memoKeyOf(PRODUCTION_LINES[0].id, key);
    const revived = (list ?? []).map((m) => ({ ...m, at: new Date(m.at) }));
    out[k] = out[k] ? [...out[k], ...revived].sort((a, b) => b.at - a.at) : revived;
  }
  return out;
};

/**
 * 대기열 불변식 — 선두는 생산 중(RUNNING), 나머지는 대기(IDLE).
 *  엔진은 선두 '위치'만 보고 시간을 진행시키므로, state 는 표시용이다.
 *  참조는 값이 실제로 바뀌는 로트만 갈아끼운다 (불필요한 리렌더 방지).
 */
const normalizeQueue = (queue) =>
  queue.map((j, i) =>
    i === 0
      ? (j.state === 'RUNNING' ? j : { ...j, state: 'RUNNING' })
      : (j.state === 'RUNNING' ? { ...j, state: 'IDLE' } : j)
  );

/* 저장된 대기열도 같은 불변식으로 되살린다 — 구버전 저장분(선두 IDLE)을 바로잡는다 */
const reviveJobsByLine = (stored) =>
  Object.fromEntries(
    Object.entries(stored ?? {}).map(([lineId, queue]) => [lineId, normalizeQueue(queue ?? [])])
  );

export default function DigitalTwinDashboard() {
  /* 기본은 라이트. 키를 ui.appearance 로 올려 예전 자동 저장값(dark)에 안 끌려간다 */
  const [appearance, setAppearance] = usePersistentState('ui.appearance', 'light');
  /* 로그인 세션 — { id, name, role, at }. 없으면 로그인 화면만 보인다. */
  const [session, setSession] = usePersistentState('session', null);
  const [mode, setMode] = useState('operation');
  const [plant, setPlant] = useState(PLANTS[0].id);
  /* 대기열(로트)은 라인별로 완전히 분리된다. 품목 카탈로그(products)만 라인 공용이다.
     대기열·카탈로그·배치·메모·이력은 localStorage 에 저장되어 새로고침에도 유지된다. */
  const [jobsByLine, setJobsByLine] = usePersistentState('jobsByLine', INITIAL_JOBS_BY_LINE, reviveJobsByLine);
  const [products, setProducts] = usePersistentState('products', INITIAL_PRODUCT_CATALOG);
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
  const [sourceModal, setSourceModal] = useState(false);

  /* 텔레메트리 데이터 소스 — 시뮬레이션(기본) 또는 OPC-UA WebSocket 게이트웨이 */
  const [telemetryConfig, setTelemetryConfig] = usePersistentState('telemetryConfig', { type: 'sim' });

  /* 튜토리얼 — 로그인(또는 세션이 살아있는 재접속)마다 자동 실행.
     건너뛰면 그 세션 동안만 닫히고, 프로필 메뉴에서 언제든 다시 볼 수 있다. */
  const [tutorialOpen, setTutorialOpen] = useState(false);
  useEffect(() => {
    if (session) setTutorialOpen(true);
  }, [session]);

  /* 라인별 설비 배치 오프셋 / 설비 메모 — 메모는 호기(라인×설비) 단위로 붙는다 */
  const [offsetsByLine, setOffsetsByLine] = usePersistentState('offsetsByLine', INITIAL_OFFSETS_BY_LINE);
  const [memos, setMemos] = usePersistentState('memos', {}, reviveMemos);

  /* 생산 실적(완료된 작업)·운영 이벤트 로그 — 리포트 화면의 데이터 소스 */
  const [production, setProduction] = usePersistentState('production', []);
  const [events, setEvents] = usePersistentState('events', []);
  /* 시뮬레이션 스냅샷 — 예측을 저장해 두고 리포트 센터에서 계획끼리 비교한다 */
  const [simSnapshots, setSimSnapshots] = usePersistentState('simSnapshots', []);

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
  /* 상세 패널이 보는 것은 형식 마스터가 아니라 '이 라인의 호기' — 시리얼·이력이 라인마다 다르다 */
  const selectedAsset = useMemo(() => findLineAsset(plant, selectedId), [plant, selectedId]);
  const lineAssets = useMemo(() => lineSelectableAssets(plant), [plant]);
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
        return { ...prev, [lineId]: normalizeQueue(queue.slice(1)) };
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
  /* 원자재 1개 처리(76f)가 실시간으로 택트 1개가 되도록 재생 속도를 맞춘다.
     이러면 로드 전체(도입+반복 n회+마무리)의 애니메이션 시간이 lotTotalSec 와
     정확히 일치한다 — 공정 완료 = 애니메이션 완료. */
  const EA_PERIOD_CLIP_SEC = REPEAT_PERIOD_F / CLIP_FPS; // 2.53s — 클립상 EA 1개 주기
  const taktOf = (job) =>
    job?.taktSec > 0 ? job.taktSec : job && job.qty > 0 ? job.totalSec / job.qty : EA_PERIOD_CLIP_SEC;
  const scaleOf = (takt) =>
    Math.min(4, Math.max(0.05, EA_PERIOD_CLIP_SEC / takt)) * (mode === 'simulation' ? speed : 1);

  /* 대기열이 빈 라인은 설비도 멈춘다 — 지시 없는 라인이 도는 건 부자연스럽다.
     repeats = 현재 로드의 적재 수(최대 20, 로트 잔여만큼) — 애니메이션 반복 횟수.
     경과시간에 따라 로드가 넘어갈 때만 값이 바뀌므로 문자열 키로 참조를 고정해
     씬 memo 가 매초 깨지지 않게 한다. */
  const repeatsKey = PLANTS.map((line) => {
    const head = jobsByLine[line.id]?.[0] ?? null;
    return head
      ? currentLoadAt(elapsedByLine[line.id] ?? 0, head.qty, taktOf(head)).repeats
      : CONVEYOR_LOAD_MAX;
  }).join(',');
  const animByLine = useMemo(
    () => {
      const repeats = repeatsKey.split(',');
      return Object.fromEntries(
        PLANTS.map((line, i) => [
          line.id,
          {
            timeScale: scaleOf(taktOf(jobsByLine[line.id]?.[0] ?? null)),
            paused: Boolean(eStopByLine[line.id]) || (jobsByLine[line.id]?.length ?? 0) === 0,
            repeats: Number(repeats[i]) || CONVEYOR_LOAD_MAX,
          },
        ])
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobsByLine, eStopByLine, mode, speed, repeatsKey]
  );

  /* 좌측 패널·HUD·푸터에 숫자로 보여주는 값은 선택된 라인 기준 */
  const taktSec = taktOf(currentJob);
  const animTimeScale = animByLine[plant]?.timeScale ?? 1;

  /* 오류가 걸린 설비 — 3D 하이라이트와 상세 패널이 같은 소스를 본다 */
  const faults = useMemo(
    () => (alarm ? { [alarm.lineId]: alarm.assetId } : {}),
    [alarm]
  );

  /**
   * 실린더 만충 연동 — 1세트 = 실린더 1회 충전 (computeCylinder 참조).
   *  E-STOP 이면 경과시간이 멈추므로 채움도 함께 멈추고,
   *  선두 로트 취소 시 진행분은 무효가 된다.
   */
  const cylinderOf = (lineId) => {
    const head = jobsByLine[lineId]?.[0] ?? null;
    const doneEa = head
      ? completedEaAt(elapsedByLine[lineId] ?? 0, head.qty, taktOf(head))
      : 0;
    return computeCylinder(lineStats[lineId]?.produced, doneEa, Boolean(head));
  };
  const cylinder = useMemo(
    () => cylinderOf(plant),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobsByLine, lineStats, elapsedByLine, plant]
  );

  /**
   * 라인별 반출 카운트 — 3D 반출 연출의 트리거.
   *  경과시간은 매초 바뀌지만 반출 수는 만충 순간에만 바뀐다. 값이 실제로 변할
   *  때만 참조가 갱신되게 문자열 키로 고정해, 씬 memo 가 매초 깨지지 않게 한다.
   */
  const dischargedKey = PLANTS.map((l) => cylinderOf(l.id).discharged).join(',');
  const dischargedByLine = useMemo(() => {
    const parts = dischargedKey.split(',');
    return Object.fromEntries(PLANTS.map((l, i) => [l.id, Number(parts[i]) || 0]));
  }, [dischargedKey]);

  /* 금일 누적 생산량(선택된 라인) — 완료될 때마다 점프해 배속 효과가 눈에 띈다 */
  const todayQty = useMemo(() => {
    const today = fmtDate(new Date());
    return production
      .filter((p) => p.lineId === plant && fmtDate(new Date(p.finishedAt)) === today)
      .reduce((sum, p) => sum + p.qty, 0);
  }, [production, plant]);

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
  /* 게이트웨이 알람 — FAULT_SCENARIOS 와 같은 형태라 기존 알람 플로우가 그대로 동작.
     이미 알람이 떠 있으면 새 알람은 무시한다 (한 번에 하나 — 기존 UX 유지) */
  const alarmRef = useRef(alarm);
  alarmRef.current = alarm;
  const handleGatewayAlarm = useCallback(
    (a) => {
      if (alarmRef.current) return;
      const next = { ...a, at: new Date(), acked: false };
      /* ref 를 즉시 선점한다 — 연속 프레임 2건이 재렌더 커밋 전에 도착해도
         가드를 둘 다 통과해 이벤트가 이중 기록되지 않게 (해제는 렌더 동기화가 처리) */
      alarmRef.current = next;
      setAlarm(next);
      logEvent('ALARM_RAISED', `[${a.code}] ${a.title}`, { lineId: a.lineId, assetId: a.assetId });
    },
    [logEvent]
  );

  const telemetry = useTelemetry({
    stoppedByLine: telemetryStopped,
    faults,
    sourceConfig: telemetryConfig,
    onAlarm: handleGatewayAlarm,
  });
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

  /** 선택된 라인의 대기열만 갈아끼운다 — 다른 라인은 건드리지 않는다.
   *  엔진은 대기열 '선두 위치'만 보고 시간을 진행시키므로, 표시 상태가 실제와
   *  어긋나지 않게 갱신 때마다 선두=RUNNING·나머지=IDLE 불변식을 강제한다.
   *  (빈 대기열에 로트를 추가하면 선두가 IDLE 로 남아 '대기'로 보이던 버그) */
  const updateLineJobs = (updater) =>
    setJobsByLine((prev) => ({ ...prev, [plant]: normalizeQueue(updater(prev[plant] ?? [])) }));

  /* 확인 팝업에서 '작업 취소'를 누른 뒤에만 실제로 제거된다 */
  const handleCancelJob = (id) => {
    const cancelled = jobs.find((j) => j.id === id);
    const wasHead = currentJob?.id === id;
    /* 선두를 취소했으면 다음 작업이 곧바로 올라온다 (updateLineJobs 가 RUNNING 으로 승격) */
    updateLineJobs((prev) => prev.filter((j) => j.id !== id));
    if (wasHead) resetElapsed(plant);
    setSelectedJobId((cur) => (cur === id ? null : cur));
    setJobCancelTarget(null);
    if (cancelled) {
      logEvent('JOB_CANCELLED', `${cancelled.name} (${cancelled.id}) 취소`, { lineId: plant });
    }
  };

  /** 대기열 드래그 정렬 — 선두가 바뀌면 진행 시간을 0 부터 다시 센다 */
  const handleReorderJobs = (from, to) => {
    const queue = jobs;
    if (from === to || !queue[from]) return;
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const headChanged = next[0]?.id !== queue[0]?.id;
    /* 새 선두 RUNNING·밀려난 선두 IDLE 정리는 updateLineJobs 의 불변식이 처리한다 */
    updateLineJobs(() => next);
    if (headChanged) resetElapsed(plant);
    logEvent('JOB_REORDERED', `${moved.name} 순서 변경 (${from + 1}번 → ${to + 1}번)`, { lineId: plant });
  };

  /** 시뮬레이션 결과를 스냅샷으로 저장 — 리포트 센터의 '시뮬레이션' 탭에서 비교한다.
   *  표·비교 카드·엑셀이 읽는 필드만 저장한다 (localStorage 30건 공유 저장소).
   *  ※ p50Sec/p90Sec 는 배속으로 나눈 벽시계 초 — 배속이 다른 스냅샷과 비교할 땐 단위가 다르다. */
  const handleSaveSimSnapshot = (r) => {
    if (!can('jobs.manage')) return; // 게스트는 공유 스냅샷 저장소를 덮어쓸 수 없다
    const snap = {
      id: `SIM-${Date.now()}`,
      at: new Date().toISOString(),
      lineId: plant,
      user: session?.name,
      speed: r.speed,
      lots: r.summary.lots,
      totalQty: r.summary.totalQty,
      cylinders: r.summary.cylinders,
      p50Sec: r.finishWallSec.p50,
      p90Sec: r.finishWallSec.p90,
      finishAtP50: r.finishAtP50.toISOString(),
      defectsMean: r.defects.mean,
    };
    setSimSnapshots((prev) => [snap, ...prev].slice(0, 30));
    logEvent('SIM_SNAPSHOT', `시뮬레이션 스냅샷 저장 — ${snap.totalQty} EA · P50 ${fmtDuration(Math.round(snap.p50Sec))}`, {
      lineId: plant,
    });
  };

  const handleDeleteSnapshot = (id) => {
    /* 이벤트 기록은 업데이터 밖에서 — StrictMode 이중 실행에 걸리지 않게 */
    const snap = simSnapshots.find((s) => s.id === id);
    setSimSnapshots((prev) => prev.filter((s) => s.id !== id));
    if (snap) {
      logEvent('SIM_SNAPSHOT_DELETED', `시뮬레이션 스냅샷 삭제 — ${snap.totalQty} EA (${snap.id})`, {
        lineId: snap.lineId,
      });
    }
  };

  /**
   * 시뮬레이션의 SPT 정렬 제안 적용 — 진행 중인 선두 로트는 반드시 그대로 두고
   * 대기 로트만 제안 순서로 재배열한다 (제안이 낡았어도 선두를 끌어내리지 않게).
   */
  const handleApplyOrder = (orderedIds) => {
    updateLineJobs((prev) => {
      if (prev.length < 3) return prev;
      const head = prev[0];
      const byId = new Map(prev.slice(1).map((j) => [j.id, j]));
      const tail = orderedIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
      prev.slice(1).forEach((j) => {
        if (!tail.includes(j)) tail.push(j); // 제안에 없는 로트는 뒤에 보존
      });
      return [head, ...tail];
    });
    logEvent('JOB_REORDERED', 'SPT 최적화 정렬 적용 (짧은 로트 우선)', { lineId: plant });
  };

  /** 설비 바로가기 — 선택하고 카메라를 그 설비로 보낸다 */
  const handleFocusAsset = (assetId) => {
    setSelectedJobId(null);
    setSelectedId(assetId);
    setFocusRequest({ assetId, nonce: Date.now() });
  };

  const handleAddMemo = (assetId, text) => {
    const memo = { id: Date.now(), at: new Date(), text, author: session?.name };
    const key = memoKeyOf(plant, assetId); // 메모는 지금 보고 있는 라인의 호기에 붙는다
    setMemos((prev) => ({
      ...prev,
      [key]: [memo, ...(prev[key] ?? [])],
    }));
    logEvent('MEMO_ADDED', `${plantName} ${findAsset(assetId)?.name ?? assetId} 메모 작성`, {
      lineId: plant,
      assetId,
    });
  };

  /** 엑셀에서 선택된 행들을 '선택된 라인' 로트로 추가하고, 미등록 품목은 카탈로그에 등록한다 */
  const handleImportExcel = (rows) => {
    logEvent('JOB_IMPORTED', `엑셀 업로드로 로트 ${rows.length}건 추가`, { lineId: plant });
    updateLineJobs((prev) => [
      ...prev,
      ...rows.map((r, i) =>
        makeLot(makeLotId(nextLotSeq(prev) + i), { name: r.name, taktSec: r.taktSec }, r.qty)
      ),
    ]);
    setProducts((prev) => {
      const known = new Set(prev.map((p) => p.name));
      const added = rows
        .filter((r) => !known.has(r.name))
        .map((r, i) => ({
          id: `PRD-${String(prev.length + i + 1).padStart(2, '0')}`,
          name: r.name,
          taktSec: r.taktSec,
          defaultQty: r.qty,
        }));
      return [...prev, ...added];
    });
  };

  /** 로트 추가 — 표준시간은 수량 × 품목 택트타임 */
  const handleAddLot = (product, qty) => {
    updateLineJobs((prev) => [...prev, makeLot(makeLotId(nextLotSeq(prev)), product, qty)]);
    logEvent('JOB_ADDED', `${product.name} · ${qty} EA 로트 추가`, { lineId: plant });
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
        onStartTutorial={() => setTutorialOpen(true)}
      />

      <div className="relative flex-1 min-h-0 flex">
        <LeftDashboardPanel
          theme={theme}
          mode={mode}
          jobs={jobs}
          onRequestCancel={setJobCancelTarget}
          selectedJobId={selectedJobId}
          onSelectJob={setSelectedJobId}
          onReorderJobs={handleReorderJobs}
          onApplyOrder={handleApplyOrder}
          onSaveSnapshot={handleSaveSimSnapshot}
          todayQty={todayQty}
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
          cylinder={cylinder}
          lineAssets={lineAssets}
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
          onFocusAsset={handleFocusAsset}
          dischargedByLine={dischargedByLine}
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
          lineName={plantName}
          memos={memos[memoKeyOf(plant, selectedId)] ?? []}
          onAddMemo={handleAddMemo}
          memoAuthor={session.name}
          canWriteMemo={can('memo.write')}
          memoHint={PERMISSION_HINTS['memo.write']}
          lineId={plant}
          telemetry={telemetry}
          lineTaktSec={taktSec}
          cylinder={cylinder}
        />
      </div>

      {/* 하단 스테이터스 바 */}
      <footer
        className={`h-7 shrink-0 flex items-center justify-between px-4 border-t ${theme.panelBorder}
          ${theme.headerBg} text-[10px] tabular-nums ${theme.textFaint}`}
      >
        <div className="flex items-center gap-4">
          {/* 데이터 소스 상태 — 시뮬레이션/실계측·연결 상태를 정직하게 표시.
              누구나 클릭해 현재 소스·연결 안내를 볼 수 있고, 전환은 관리자만 가능하다
              (연결 실패 시 비관리자에게도 원인·조치 안내가 닿아야 한다) */}
          <button
            type="button"
            onClick={() => setSourceModal(true)}
            title={can('source.configure') ? '데이터 소스 설정' : PERMISSION_HINTS['source.configure']}
            className="flex items-center gap-1.5 hover:underline cursor-pointer"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                telemetry.status === 'error'
                  ? 'bg-red-500'
                  : ['connecting', 'reconnecting'].includes(telemetry.status)
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-emerald-500'
              }`}
            />
            {telemetry.sourceInfo.label}{' '}
            {telemetry.status === 'connecting'
              ? '연결 중…'
              : telemetry.status === 'reconnecting'
                ? '재연결 중…'
                : telemetry.status === 'error'
                  ? '연결 실패'
                  : '연결됨'}
          </button>
          <span>Latency {telemetry.latencyMs ?? '--'}ms</span>
          <span>Sync {fmtDate(now)} {fmtClock(now)}</span>
          {/* 비상 정지가 라인 단위라, 보고 있지 않은 라인이 멈춰 있어도 알 수 있어야 한다 */}
          {stoppedLines.length > 0 && (
            <span className="flex items-center gap-1.5 font-semibold text-red-500">
              <AlertOctagon className="w-3 h-3" />
              E-STOP {stoppedLines.map((l) => l.name).join(' · ')}
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
          asset={findLineAsset(alarm.lineId, alarm.assetId)}
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
          products={products}
          onAddProduct={(product) => setProducts((prev) => [...prev, product])}
          onAddLot={handleAddLot}
          onClose={() => setJobAddModal(false)}
        />
      )}

      {excelModal && (
        <ExcelUploadModal
          theme={theme}
          products={products}
          onImport={handleImportExcel}
          onClose={() => setExcelModal(false)}
        />
      )}

      {expandedCam && (
        <CctvModal theme={theme} cam={expandedCam} now={now} onClose={() => setExpandedCam(null)} />
      )}

      {sourceModal && (
        <SourceSettingsModal
          theme={theme}
          config={telemetryConfig}
          connectionStatus={telemetry.status}
          readOnly={!can('source.configure')}
          onSave={(next) => {
            if (!can('source.configure')) return; // 읽기 전용(비관리자) 방어선
            setTelemetryConfig(next);
            logEvent(
              'SOURCE_CHANGED',
              next.type === 'opcua' ? `데이터 소스 → OPC-UA 게이트웨이 (${next.url})` : '데이터 소스 → 시뮬레이션'
            );
          }}
          onClose={() => setSourceModal(false)}
        />
      )}

      {/* 튜토리얼 — 로그인마다 자동으로 뜨고, 닫으면 이번 세션 동안만 닫힌다 */}
      {tutorialOpen && (
        <TutorialOverlay theme={theme} onClose={() => setTutorialOpen(false)} />
      )}

      {reportModal && (
        <ReportModal
          theme={theme}
          production={production}
          events={events}
          lineStats={lineStats}
          simSnapshots={simSnapshots}
          onDeleteSnapshot={handleDeleteSnapshot}
          canManageSnapshots={can('jobs.manage')}
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
