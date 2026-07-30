/**
 * =============================================================================
 *  EGIS Factory - Digital Twin System
 * =============================================================================
 *  Stack : React 19 / Vite / Tailwind v4 / lucide-react / react-three-fiber
 *
 *  [ 파일 구성 ]
 *   src/
 *    ├─ DigitalTwinDashboard.jsx   ← 이 파일 (레이아웃 + 2D UI 전체)
 *    ├─ theme.js                   다크/라이트 × 운전/시뮬레이션 4조합 토큰
 *    ├─ scene/FactoryScene.jsx     3D 씬 (그리드 / OrbitControls / GLB / 픽킹)
 *    └─ data/factoryAssets.js      설비 마스터 + 상태 정의
 *
 *  [ 추가 분리 가이드 ]
 *   components/gnb/    TopGnb, PlantSelector, ModeToggle, EmergencyStopButton
 *   components/left/   LeftDashboardPanel, LineProgress, JobQueueList
 *   components/view/   TwinViewport, ViewportToolbar, CctvPipPanel
 *   components/right/  AssetDetailSidebar, AssetTransform, AssetMemoLog
 *   components/modal/  JobAddModal, CctvModal, EStopModal
 * =============================================================================
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  Boxes,
  Camera,
  ChevronDown,
  Clock,
  Cpu,
  Factory,
  FileDown,
  Gauge,
  Grid3x3,
  GripVertical,
  Layers,
  Maximize2,
  Move3d,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  StickyNote,
  Sun,
  Trash2,
  Upload,
  User,
  Video,
  Wrench,
  X,
} from 'lucide-react';

import FactoryScene, { CAMERA_HOME } from './scene/FactoryScene.jsx';
import { FACTORY_ASSETS, SELECTABLE_ASSETS, STATUS, findAsset } from './data/factoryAssets.js';
import { getTheme } from './theme.js';
import {
  OPTIONAL_COLUMNS,
  REQUIRED_COLUMNS,
  downloadJobTemplate,
  parseJobWorkbook,
} from './lib/jobExcel.js';

/* ---------------------------------------------------------------------------
 * 1. Mock Data
 * ------------------------------------------------------------------------- */
const PLANTS = [
  { id: 'L1', name: 'DM뷰 - Line_1' },
  { id: 'L2', name: 'DM뷰 - Line_2' },
  { id: 'L3', name: 'DM뷰 - Line_3' },
];

/* 작업 카탈로그 — '작업 추가' 팝업에서 선택하거나 새로 등록한다 */
const INITIAL_JOB_TEMPLATES = [
  { id: 'TPL-01', name: 'HPG 원자재 개포장', qty: 120, totalSec: 900 },
  { id: 'TPL-02', name: 'HPG 원자재 이송', qty: 80, totalSec: 720 },
  { id: 'TPL-03', name: '실린더 충전 (CART-01)', qty: 240, totalSec: 1500 },
  { id: 'TPL-04', name: '충전 후 계량/검사', qty: 36, totalSec: 480 },
  { id: 'TPL-05', name: '공(空)실린더 회수/세척', qty: 60, totalSec: 600 },
];

const INITIAL_JOBS = [
  { id: 'WO-2607-001', name: 'HPG 원자재 개포장', qty: 120, totalSec: 900, state: 'RUNNING' },
  { id: 'WO-2607-002', name: 'HPG 원자재 이송', qty: 80, totalSec: 720, state: 'IDLE' },
  { id: 'WO-2607-003', name: '실린더 충전 (CART-01)', qty: 240, totalSec: 1500, state: 'IDLE' },
  { id: 'WO-2607-004', name: '충전 후 계량/검사', qty: 36, totalSec: 480, state: 'ERROR' },
  { id: 'WO-2607-005', name: '공(空)실린더 회수/세척', qty: 60, totalSec: 600, state: 'IDLE' },
];

const CCTV_FEEDS = [
  { id: 'CAM-01', label: 'Line_1 · 절단기 상부', src: '/cctv/cam-01.mp4' },
  { id: 'CAM-02', label: 'Line_1 · 컨베이어 정면', src: '/cctv/cam-02.mp4' },
];

/* ---------------------------------------------------------------------------
 * 2. 시간 훅 / 포맷터 — "시간이 흘러가는" 표현의 단일 소스
 * ------------------------------------------------------------------------- */
function useWallClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** 운전 모드는 1초에 1초, 시뮬레이션은 1초에 speed초 진행. 표준시간 도달 시 순환. */
function useJobTimer({ totalSec, speed, paused }) {
  const [elapsed, setElapsed] = useState(451);
  useEffect(() => {
    if (paused) return undefined;
    const id = setInterval(() => setElapsed((e) => (e + speed) % totalSec), 1000);
    return () => clearInterval(id);
  }, [speed, paused, totalSec]);
  return elapsed;
}

const pad = (n) => String(Math.floor(n)).padStart(2, '0');
const fmtDuration = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)} : ${pad(s % 60)}`;
};
const fmtClock = (d, withSeconds = true) =>
  `${pad(d.getHours())}:${pad(d.getMinutes())}${withSeconds ? `:${pad(d.getSeconds())}` : ''}`;
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtKoDateTime = (d) =>
  `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours() < 12 ? '오전' : '오후'} ` +
  `${pad(d.getHours() % 12 || 12)}:${pad(d.getMinutes())}`;

/* ---------------------------------------------------------------------------
 * 3. 공용 프리미티브
 * ------------------------------------------------------------------------- */
const Panel = ({ theme, className = '', children }) => (
  <section className={`rounded-xl border ${theme.panelBorder} ${theme.panelBg} backdrop-blur-sm ${className}`}>
    {children}
  </section>
);

const PanelTitle = ({ icon: Icon, title, right, theme }) => (
  <header className={`flex items-center justify-between px-3 py-2.5 border-b ${theme.divider}`}>
    <div className="flex items-center gap-2">
      <Icon className={`w-4 h-4 ${theme.accentText}`} />
      <h2 className={`text-[13px] font-semibold tracking-tight ${theme.textPrimary}`}>{title}</h2>
    </div>
    {right}
  </header>
);

const StatusLamp = ({ state, size = 'sm', showLabel = true }) => {
  const s = STATUS[state] ?? STATUS.IDLE;
  const dot = size === 'lg' ? 'w-3.5 h-3.5' : 'w-2 h-2';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`relative flex ${dot}`}>
        {s.pulse && <span className={`absolute inline-flex w-full h-full rounded-full opacity-60 animate-ping ${s.dot}`} />}
        <span className={`relative inline-flex w-full h-full rounded-full ring-2 ${s.ring} ${s.dot}`} />
      </span>
      {showLabel && <span className={`text-xs font-medium ${s.text}`}>{s.label}</span>}
    </span>
  );
};

const GhostButton = ({ icon: Icon, children, onClick, theme, danger = false, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center justify-center gap-1 rounded-md border px-1.5 py-1.5
      text-[11px] font-medium whitespace-nowrap transition-colors focus:outline-none focus:ring-2 ${theme.accentRing}
      ${danger
        ? 'border-red-500/40 text-red-500 hover:bg-red-500/10'
        : `${theme.panelBorder} ${theme.textSecondary} ${theme.hoverBg}`} ${className}`}
  >
    {Icon && <Icon className="w-3.5 h-3.5" />}
    {children}
  </button>
);

const ConsumableBar = ({ label, percent, theme }) => {
  const tone = percent <= 15 ? 'bg-red-500' : percent <= 40 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className={theme.textMuted}>{label}</span>
        <span className={`font-bold tabular-nums ${percent <= 15 ? 'text-red-500' : theme.textPrimary}`}>{percent}%</span>
      </div>
      <div className={`mt-1 h-2 rounded-full overflow-hidden ${theme.trackBg}`}>
        <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};

/** 모달 공통 셸 */
const Modal = ({ theme, onClose, children, className = 'w-[460px]' }) => (
  <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
    <div
      className={`${className} max-h-full overflow-hidden rounded-2xl border ${theme.panelBorder} ${theme.headerBg} shadow-2xl`}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  </div>
);

/**
 * 회사 로고. public/logo.png 를 사용하며, 파일이 없으면 기본 아이콘으로 대체됩니다.
 *
 * 색상 처리:
 *  logo.png 는 순백(255,255,255) 단색 알파 실루엣입니다(픽셀 검증: 휘도 min=max=255).
 *  색상 정보가 없는 마스크이므로 mask-image 로 형태만 따고 배경색을 입히면
 *  어떤 색으로든 정확히 칠할 수 있습니다. filter 방식과 달리 임의 색 지정이 가능합니다.
 *   - 다크  : 흰색
 *   - 라이트: 모드별 포인트 컬러(운전=블루 / 시뮬레이션=자주)
 *  ※ 컬러 로고로 교체하면 마스크가 단색으로 뭉개므로, 그때는 <img> 로 되돌리세요.
 */
const BrandLogo = ({ theme }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const probe = new Image();
    probe.onerror = () => setFailed(true);
    probe.src = '/logo.png';
  }, []);

  if (failed) {
    return (
      <div className={`grid place-items-center w-8 h-8 rounded-lg ${theme.accentBg}`}>
        <Boxes className="w-[18px] h-[18px] text-white" />
      </div>
    );
  }

  const mask = {
    WebkitMaskImage: 'url(/logo.png)',
    maskImage: 'url(/logo.png)',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
  };

  return (
    <span
      role="img"
      aria-label="EGIS"
      className="block w-8 h-8 shrink-0 transition-colors duration-300"
      style={{
        ...mask,
        backgroundColor: theme.appearance === 'light' ? theme.accentHex : '#ffffff',
      }}
    />
  );
};

/* ---------------------------------------------------------------------------
 * 4. Top GNB
 * ------------------------------------------------------------------------- */
const TopGnb = ({
  theme, mode, onModeChange, plant, onPlantChange,
  eStopEngaged, onEStop, now, simElapsed, speed,
  appearance, onToggleAppearance,
}) => (
  <header className={`h-14 shrink-0 flex items-center justify-between gap-4 px-4 border-b ${theme.panelBorder} ${theme.headerBg} z-30`}>
    {/* --- 좌: 로고 + 라인 선택 --- */}
    <div className="flex items-center gap-4 min-w-0">
      <div className="flex items-center gap-2 shrink-0">
        <BrandLogo theme={theme} />
        <div className="leading-none">
          <p className={`text-[13px] font-bold tracking-tight ${theme.textPrimary}`}>
            EGIS <span className={theme.accentText}>Factory</span>
          </p>
          <p className={`text-[10px] mt-0.5 ${theme.textFaint}`}>Digital Twin System</p>
        </div>
      </div>

      <div className="relative">
        <Factory className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none ${theme.textMuted}`} />
        <select
          value={plant}
          onChange={(e) => onPlantChange(e.target.value)}
          className={`appearance-none h-9 pl-8 pr-8 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
            text-xs ${theme.textSecondary} focus:outline-none focus:ring-2 ${theme.accentRing} cursor-pointer`}
        >
          {PLANTS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <ChevronDown className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none ${theme.textMuted}`} />
      </div>
    </div>

    {/* --- 중앙: 운전 / 시뮬레이션 토글 --- */}
    <div className={`relative flex items-center p-1 rounded-full border ${theme.panelBorder} ${theme.subtleBg}`}>
      <span
        className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full transition-all duration-300 ease-out
          ${theme.accentBg} ${mode === 'operation' ? 'left-1' : 'left-[calc(50%+3px)]'}`}
      />
      {[
        { key: 'operation', label: '운전 모드', icon: Activity },
        { key: 'simulation', label: '시뮬레이션 모드', icon: Cpu },
      ].map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onModeChange(key)}
          className={`relative z-10 flex items-center gap-1.5 px-4 h-7 rounded-full text-[11px] font-semibold
            transition-colors ${mode === key ? 'text-white' : `${theme.textMuted}`}`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>

    {/* --- 우: 시계 + 테마 + E-STOP + 프로필 --- */}
    <div className="flex items-center gap-2.5">
      <div className={`hidden xl:flex flex-col items-end leading-none px-3 py-1 rounded-lg border ${theme.panelBorder} ${theme.subtleBg}`}>
        <span className={`flex items-center gap-1 text-[9px] font-bold tracking-widest ${theme.textFaint}`}>
          {mode === 'operation' ? (
            <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />LIVE</>
          ) : (
            <><span className="w-1.5 h-1.5 rounded-full bg-fuchsia-500" />SIM ×{speed.toFixed(1)}</>
          )}
        </span>
        <span className={`mt-1 text-sm font-bold tabular-nums ${theme.textPrimary}`}>
          {mode === 'operation' ? fmtClock(now) : `T+ ${fmtDuration(simElapsed)}`}
        </span>
      </div>

      {/* 다크 / 라이트 전환 */}
      <button
        type="button"
        onClick={onToggleAppearance}
        title={appearance === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
        aria-label="테마 전환"
        className={`grid place-items-center w-9 h-9 rounded-lg border ${theme.panelBorder} ${theme.subtleBg}
          ${theme.textSecondary} ${theme.hoverBg} transition-colors`}
      >
        {appearance === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      <button
        type="button"
        onClick={onEStop}
        className={`group flex items-center gap-2 h-10 px-4 rounded-lg font-extrabold text-[13px] tracking-tight
          text-white border-b-4 active:border-b-0 active:translate-y-[3px] transition-all
          focus:outline-none focus:ring-4 focus:ring-red-500/40
          ${eStopEngaged
            ? 'bg-red-700 border-red-900 animate-pulse'
            : 'bg-red-600 hover:bg-red-500 border-red-800 shadow-[0_0_20px_-4px_rgba(239,68,68,0.7)]'}`}
      >
        <AlertOctagon className="w-5 h-5" />
        {eStopEngaged ? 'E-STOP 작동 중' : '비상 정지'}
      </button>

      <div className={`h-6 w-px ${theme.dividerStrong}`} />

      <button type="button" className={`flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg ${theme.hoverBg}`}>
        <span className={`grid place-items-center w-7 h-7 rounded-full ${theme.accentBg} text-white`}>
          <User className="w-4 h-4" />
        </span>
        <span className="text-left leading-none hidden lg:block">
          <span className={`block text-[11px] font-semibold ${theme.textSecondary}`}>백성열</span>
          <span className={`block text-[10px] mt-0.5 ${theme.textFaint}`}>라인 관리자</span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 ${theme.textFaint}`} />
      </button>
    </div>
  </header>
);

/* ---------------------------------------------------------------------------
 * 5. 좌측 패널
 * ------------------------------------------------------------------------- */
const LeftDashboardPanel = ({
  theme, mode, jobs, onRemoveJob, onOpenJobAdd, onOpenExcel,
  speed, onSpeedChange, currentJob, elapsed, now,
}) => {
  const progress = currentJob ? Math.min(100, (elapsed / currentJob.totalSec) * 100) : 0;
  const targetQty = jobs.reduce((sum, j) => sum + j.qty, 0);
  const doneQty = currentJob ? Math.round(currentJob.qty * (progress / 100)) : 0;

  const finishAt = useMemo(() => {
    if (!currentJob) return '--:--';
    const remain = (currentJob.totalSec - elapsed) / speed;
    return fmtClock(new Date(now.getTime() + remain * 1000), false);
  }, [currentJob, elapsed, speed, now]);

  const stages = [
    { name: '개포장', value: Math.round(progress) },
    { name: '이송', value: 78 },
    { name: '충전', value: 54 },
    { name: '검사', value: 31 },
  ];

  return (
    <aside className="w-[320px] shrink-0 h-full flex flex-col gap-3 p-3 overflow-y-auto">
      {/* 5-1. 작업 진행률 --------------------------------------------- */}
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
            <StatusLamp state={currentJob?.state ?? 'IDLE'} />
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
              <li key={s.name} className="flex items-center gap-2">
                <span className={`w-11 text-[11px] shrink-0 ${theme.textMuted}`}>{s.name}</span>
                <span className={`flex-1 h-1.5 rounded-full overflow-hidden ${theme.trackBg}`}>
                  <span
                    className={`block h-full rounded-full bg-gradient-to-r ${theme.barFrom} ${theme.barTo}`}
                    style={{ width: `${s.value}%`, transition: 'width 900ms linear' }}
                  />
                </span>
                <span className={`w-9 text-right text-[11px] tabular-nums ${theme.textSecondary}`}>{s.value}%</span>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      {/* 5-2. 작업 대기열 --------------------------------------------- */}
      <Panel theme={theme} className="flex-1 min-h-[220px] flex flex-col">
        <PanelTitle
          icon={Layers}
          title="작업 대기열"
          theme={theme}
          right={<span className={`text-[10px] tabular-nums ${theme.textFaint}`}>{jobs.length} JOBS</span>}
        />

        <ul className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {jobs.map((job, idx) => (
            <li
              key={job.id}
              className={`group flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors cursor-grab
                ${idx === 0 ? `${theme.accentBgSoft} ${theme.panelBorder}` : `${theme.panelBorder} ${theme.cardBg} ${theme.hoverBg}`}`}
            >
              <GripVertical className={`w-3.5 h-3.5 shrink-0 ${theme.textGhost}`} />
              <span className={`w-5 text-[10px] tabular-nums ${theme.textGhost}`}>{pad(idx + 1)}</span>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[12px] font-medium ${theme.textSecondary}`}>{job.name}</p>
                <p className={`text-[10px] tabular-nums ${theme.textFaint}`}>
                  {job.id} · {job.qty} EA · 표준 {fmtDuration(job.totalSec)}
                </p>
              </div>
              <StatusLamp state={job.state} showLabel={false} />
              <button
                type="button"
                onClick={() => onRemoveJob(job.id)}
                className={`opacity-0 group-hover:opacity-100 transition hover:text-red-500 ${theme.textFaint}`}
                aria-label={`${job.name} 삭제`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>

        <footer className={`grid grid-cols-3 gap-1.5 p-2 border-t ${theme.divider}`}>
          <GhostButton icon={Plus} theme={theme} onClick={onOpenJobAdd}>작업 추가</GhostButton>
          <GhostButton icon={Upload} theme={theme} onClick={onOpenExcel}>엑셀 업로드</GhostButton>
          <GhostButton icon={X} theme={theme} danger>취소</GhostButton>
        </footer>
      </Panel>

      {/* 5-3. 시뮬레이션 배속 ------------------------------------------ */}
      <Panel theme={theme}>
        <PanelTitle
          icon={Settings2}
          title="시뮬레이션 배속"
          theme={theme}
          right={<span className={`text-xs font-bold tabular-nums ${theme.accentText}`}>{speed.toFixed(1)}x</span>}
        />
        <div className="p-3 pt-2.5">
          <input
            type="range"
            min={1} max={4} step={0.5}
            value={speed}
            disabled={mode !== 'simulation'}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
            className={`w-full h-1.5 rounded-full appearance-none cursor-pointer ${theme.trackBg}
              disabled:opacity-40 disabled:cursor-not-allowed
              ${mode === 'simulation' ? 'accent-fuchsia-500' : 'accent-sky-500'}`}
          />
          <div className={`flex justify-between mt-1.5 text-[10px] tabular-nums ${theme.textFaint}`}>
            {[1, 2, 3, 4].map((v) => <span key={v}>{v}x</span>)}
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

/* ---------------------------------------------------------------------------
 * 6. 중앙 - 3D 뷰포트 (+ CCTV PIP)
 * ------------------------------------------------------------------------- */
const TwinViewport = ({
  theme, mode, selectedId, selectedAsset, onSelect,
  offsets, onMove, onOffsetReset, now, simElapsed, speed, onExpandCam,
}) => {
  const controlsRef = useRef(null);
  const wrapperRef = useRef(null);
  const [cctvOpen, setCctvOpen] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showShell, setShowShell] = useState(true);
  const [shellOpacity, setShellOpacity] = useState(0.5);
  const [viewPanelOpen, setViewPanelOpen] = useState(false);

  const resetCamera = () => {
    const c = controlsRef.current;
    if (!c) return;
    c.object.position.set(...CAMERA_HOME.position);
    c.target.set(...CAMERA_HOME.target);
    c.update();
  };

  const toggleFullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  const tools = [
    { icon: Move3d, label: '카메라 리셋', onClick: resetCamera },
    { icon: Grid3x3, label: '그리드', onClick: () => setShowGrid((v) => !v), active: showGrid },
    { icon: Layers, label: '건물 셸 설정', onClick: () => setViewPanelOpen((v) => !v), active: viewPanelOpen },
    { icon: RotateCcw, label: '시점 초기화', onClick: resetCamera },
    { icon: Maximize2, label: '전체 화면', onClick: toggleFullscreen },
  ];

  return (
    <main className="relative flex-1 min-w-0 h-full p-3 pl-0">
      <div
        ref={wrapperRef}
        className={`relative w-full h-full rounded-xl overflow-hidden border ${theme.panelBorder} ${theme.glow}`}
        style={{ backgroundColor: theme.scene.bg }}
      >
        <FactoryScene
          selectedId={selectedId}
          onSelect={onSelect}
          showGrid={showGrid}
          showShell={showShell}
          shellOpacity={shellOpacity}
          offsets={offsets}
          onMove={onMove}
          theme={theme}
          controlsRef={controlsRef}
        />

        {/* --- 선택 시 상단 중앙에 뜨는 이동 피벗 리드아웃 --- */}
        {selectedAsset && (
          <div
            className={`absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-3
              rounded-lg border px-3 py-1.5 backdrop-blur-sm shadow-lg ${theme.overlayBg}`}
            style={{ borderColor: theme.accentHex }}
          >
            <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${theme.textPrimary}`}>
              <Move3d className="w-3.5 h-3.5" style={{ color: theme.accentHex }} />
              {selectedAsset.name}
            </span>
            <span className={`h-3.5 w-px ${theme.dividerStrong}`} />
            {['X', 'Y', 'Z'].map((axis, i) => (
              <span key={axis} className="flex items-baseline gap-1 text-[11px] tabular-nums">
                <span className="font-bold" style={{ color: ['#f87171', '#4ade80', '#60a5fa'][i] }}>{axis}</span>
                <span className={theme.textSecondary}>{(offsets[selectedId]?.[i] ?? 0).toFixed(2)}</span>
              </span>
            ))}
            <button
              type="button"
              onClick={() => onOffsetReset(selectedId)}
              className={`text-[10px] px-1.5 py-0.5 rounded border ${theme.panelBorder} ${theme.textMuted} ${theme.hoverBg}`}
            >
              초기화
            </button>
          </div>
        )}

        {/* --- 좌상단 상태 HUD --- */}
        <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
          <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold border ${theme.chip}`}>
            {mode === 'simulation' ? `SIMULATION ×${speed.toFixed(1)}` : 'LIVE'}
          </span>
          <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold tabular-nums
            border ${theme.panelBorder} ${theme.overlayBg} ${theme.textPrimary} backdrop-blur-sm`}>
            {mode === 'operation' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
            {mode === 'operation' ? `${fmtDate(now)}  ${fmtClock(now)}` : `T+ ${fmtDuration(simElapsed)}`}
          </span>
        </div>

        {/* --- 우상단 뷰 컨트롤 --- */}
        <div className="absolute top-3 right-3 flex flex-col gap-1.5">
          {tools.map(({ icon: Icon, label, onClick, active }, i) => (
            <button
              key={i}
              type="button"
              onClick={onClick}
              title={label}
              aria-label={label}
              className={`grid place-items-center w-8 h-8 rounded-md border backdrop-blur-sm transition
                ${theme.panelBorder} ${theme.overlayBg} ${active === false ? theme.textGhost : theme.textSecondary} ${theme.hoverBg}`}
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>

        {/* --- 건물 셸 설정 (표시 / 불투명도) --- */}
        {viewPanelOpen && (
          <div
            className={`absolute top-3 right-12 w-56 rounded-lg border ${theme.panelBorder}
              ${theme.overlayBg} backdrop-blur-md p-3 shadow-xl`}
          >
            <div className="flex items-center justify-between">
              <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${theme.textPrimary}`}>
                <Layers className={`w-3.5 h-3.5 ${theme.accentText}`} /> 건물 셸
              </span>
              <button
                type="button"
                onClick={() => setShowShell((v) => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors
                  ${showShell ? theme.accentBg : theme.trackBg}`}
                aria-label="건물 셸 표시"
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all
                    ${showShell ? 'left-[18px]' : 'left-0.5'}`}
                />
              </button>
            </div>

            <div className={`mt-3 ${showShell ? '' : 'opacity-40 pointer-events-none'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-[11px] ${theme.textMuted}`}>불투명도</span>
                <span className={`text-[11px] font-bold tabular-nums ${theme.accentText}`}>
                  {Math.round(shellOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.05} max={1} step={0.05}
                value={shellOpacity}
                onChange={(e) => setShellOpacity(Number(e.target.value))}
                className={`mt-1.5 w-full h-1.5 rounded-full appearance-none cursor-pointer ${theme.trackBg}
                  ${mode === 'simulation' ? 'accent-fuchsia-500' : 'accent-sky-500'}`}
              />
              <div className={`flex justify-between mt-1 text-[9px] tabular-nums ${theme.textFaint}`}>
                <span>투명</span><span>불투명</span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {[0.1, 0.3, 0.5, 1].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setShellOpacity(v)}
                    className={`h-6 rounded border text-[10px] tabular-nums transition-colors
                      ${Math.abs(shellOpacity - v) < 0.001
                        ? `${theme.accentBg} border-transparent text-white`
                        : `${theme.panelBorder} ${theme.textMuted} ${theme.hoverBg}`}`}
                  >
                    {v * 100}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* --- 우하단 조작 안내 --- */}
        <div className="absolute bottom-3 right-3 pointer-events-none">
          <p className={`rounded-md border ${theme.panelBorder} ${theme.overlayBg} px-2.5 py-1.5 text-[10px] leading-relaxed ${theme.textMuted} backdrop-blur-sm`}>
            좌클릭 드래그 <span className={theme.textPrimary}>회전</span> · 휠{' '}
            <span className={theme.textPrimary}>확대</span> · 우클릭 드래그{' '}
            <span className={theme.textPrimary}>이동</span> · 설비 클릭{' '}
            <span className={theme.textPrimary}>상세</span>
          </p>
        </div>

        {/* --- 하단 CCTV PIP --- */}
        <div className="absolute bottom-3 left-3 flex justify-start pointer-events-none">
          <div className={`pointer-events-auto rounded-lg border ${theme.panelBorder} ${theme.overlayBg} backdrop-blur-md ${theme.glow}`}>
            <header className={`flex items-center justify-between px-2.5 py-1.5 border-b ${theme.divider}`}>
              <div className="flex items-center gap-1.5">
                <Video className={`w-3.5 h-3.5 ${theme.accentText}`} />
                <span className={`text-[11px] font-semibold ${theme.textPrimary}`}>CCTV 모니터링</span>
                <span className="ml-1 flex items-center gap-1 text-[9px] text-red-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> REC
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCctvOpen((v) => !v)}
                className={`text-[10px] px-1 ${theme.textMuted}`}
              >
                {cctvOpen ? '접기' : '펼치기'}
              </button>
            </header>

            {cctvOpen && (
              <div className="flex gap-2 p-2">
                {CCTV_FEEDS.map((cam) => (
                  <figure
                    key={cam.id}
                    className={`relative w-[184px] aspect-video rounded-md overflow-hidden border ${theme.panelBorder} bg-slate-950 group`}
                  >
                    <video src={cam.src} className="absolute inset-0 w-full h-full object-cover" autoPlay muted loop playsInline preload="auto" />
                    <div
                      className="absolute inset-0 opacity-20 pointer-events-none mix-blend-overlay"
                      style={{
                        backgroundImage:
                          'repeating-linear-gradient(0deg, rgba(0,0,0,.5) 0px, rgba(0,0,0,.5) 1px, transparent 1px, transparent 3px)',
                      }}
                    />
                    <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between px-1.5 py-1 bg-gradient-to-t from-black/90 to-transparent">
                      <span className="text-[9px] font-medium text-slate-100">{cam.label}</span>
                      <span className="text-[9px] tabular-nums text-slate-300">{cam.id}</span>
                    </figcaption>
                    <span className="absolute top-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[8px] tabular-nums text-slate-300">
                      {fmtClock(now)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onExpandCam(cam)}
                      className="absolute top-1 right-1 grid place-items-center w-5 h-5 rounded bg-black/60
                        text-slate-200 opacity-0 group-hover:opacity-100 transition hover:bg-black/80"
                      aria-label={`${cam.label} 확대`}
                    >
                      <Maximize2 className="w-3 h-3" />
                    </button>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
};

/* ---------------------------------------------------------------------------
 * 7. 우측 사이드바
 * ------------------------------------------------------------------------- */
const AssetDetailSidebar = ({ theme, mode, asset, onClose, now, memos, onAddMemo }) => {
  const [simCount, setSimCount] = useState(100);
  const [simRunning, setSimRunning] = useState(false);
  const [memoDraft, setMemoDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(true);

  const eta = useMemo(() => {
    if (!asset) return '--:--';
    return fmtClock(new Date(now.getTime() + asset.cycleSec * simCount * 1000), false);
  }, [asset, simCount, now]);

  const open = Boolean(asset);
  const status = STATUS[asset?.status ?? 'IDLE'];

  const submitMemo = () => {
    const text = memoDraft.trim();
    if (!text || !asset) return;
    onAddMemo(asset.id, text);
    setMemoDraft('');
  };

  return (
    <aside
      className={`absolute top-0 right-0 h-full w-[360px] z-20 transition-transform duration-300 ease-out
        ${open ? 'translate-x-0' : 'translate-x-full'}`}
      aria-hidden={!open}
    >
      <div className={`h-full flex flex-col border-l ${theme.panelBorder} ${theme.headerBg} shadow-2xl shadow-black/40`}>
        {/* --- 헤더 --- */}
        <header className={`shrink-0 px-4 py-3 border-b ${theme.panelBorder} ${theme.accentBgSoft}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`text-[10px] font-semibold tracking-widest ${theme.accentText}`}>EQUIPMENT DETAIL</p>
              <h2 className={`mt-1 text-[17px] font-bold truncate ${theme.textPrimary}`}>{asset?.name ?? '-'}</h2>
              <p className={`text-[11px] tabular-nums mt-0.5 ${theme.textMuted}`}>{asset?.sn} / {asset?.mfgDate}</p>
              <p className={`text-[11px] mt-0.5 ${theme.textFaint}`}>{asset?.maker}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className={`shrink-0 grid place-items-center w-7 h-7 rounded-md ${theme.textMuted} ${theme.hoverBg}`}
              aria-label="닫기"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {asset?.consumable && (
            <div className={`mt-3 rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
              <ConsumableBar label={asset.consumable.label} percent={asset.consumable.percent} theme={theme} />
            </div>
          )}

          <div className={`mt-2 flex items-center gap-3 rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
            <StatusLamp state={asset?.status ?? 'IDLE'} size="lg" showLabel={false} />
            <div className="min-w-0">
              <p className={`text-[12px] font-semibold ${status?.text}`}>{status?.label}</p>
              <p className={`text-[11px] truncate ${theme.textMuted}`}>{asset?.statusMessage ?? '-'}</p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* --- 기본 정보 --- */}
          <Panel theme={theme}>
            <PanelTitle icon={Cpu} title="기본 정보" theme={theme} />
            <dl className="p-3 grid grid-cols-3 gap-y-2.5 text-[11px]">
              {[
                ['설비 ID', asset?.id],
                ['설비명', asset?.nameKo],
                ['공정 역할', asset?.role],
                ['모델', asset?.model],
                ['제조사', asset?.maker],
                ['제조년월', asset?.mfgDate],
                ['설치일', asset?.installedAt],
                ['Cycle Time', asset ? `${asset.cycleSec.toFixed(1)} sec` : '-'],
              ].map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className={`col-span-1 ${theme.textFaint}`}>{k}</dt>
                  <dd className={`col-span-2 tabular-nums truncate ${theme.textSecondary}`}>{v ?? '-'}</dd>
                </React.Fragment>
              ))}
            </dl>
          </Panel>

          {/* --- 점검 이력 --- */}
          <Panel theme={theme}>
            <PanelTitle
              icon={Wrench}
              title="점검 이력"
              theme={theme}
              right={
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  className={`flex items-center gap-1 text-[10px] ${theme.textMuted}`}
                >
                  차기 {asset?.nextCheck ?? '-'}
                  <ChevronDown className={`w-3 h-3 transition-transform ${historyOpen ? '' : '-rotate-90'}`} />
                </button>
              }
            />
            {historyOpen && (
              <ol className="p-3 space-y-2.5">
                {(asset?.history ?? []).map((h, i) => (
                  <li key={i} className="relative pl-4">
                    <span className={`absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full ${i === 0 ? theme.accentBg : theme.dividerStrong}`} />
                    {i < (asset?.history.length ?? 0) - 1 && (
                      <span className={`absolute left-[2.5px] top-3.5 bottom-[-10px] w-px ${theme.dividerStrong}`} />
                    )}
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] tabular-nums ${theme.textSecondary}`}>{h.date}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] border ${theme.chip}`}>{h.type}</span>
                    </div>
                    <p className={`text-[11px] mt-0.5 ${theme.textFaint}`}>{h.note}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          {/* --- 시뮬레이션 제어 --- */}
          <Panel theme={theme} className={mode === 'simulation' ? theme.glow : ''}>
            <PanelTitle
              icon={Activity}
              title="시뮬레이션 제어"
              theme={theme}
              right={<span className={`text-[10px] px-2 py-0.5 rounded border ${theme.chip}`}>{mode === 'simulation' ? 'READY' : 'LIVE 잠금'}</span>}
            />
            <div className="p-3 space-y-3">
              <label className="block">
                <span className={`block text-[11px] mb-1 ${theme.textMuted}`}>시뮬레이션 횟수 (cycle)</span>
                <input
                  type="number" min={1} max={9999}
                  value={simCount}
                  onChange={(e) => setSimCount(Math.max(1, Number(e.target.value) || 1))}
                  disabled={mode !== 'simulation'}
                  className={`w-full h-9 px-3 rounded-lg border ${theme.panelBorder} ${theme.inputBg} text-sm tabular-nums
                    ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}
                    disabled:opacity-40 disabled:cursor-not-allowed`}
                />
              </label>

              <div className={`flex items-center justify-between rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
                <span className={`flex items-center gap-1.5 text-[11px] ${theme.textMuted}`}>
                  <Clock className="w-3.5 h-3.5" /> 예측 완료 시간
                </span>
                <span className={`text-sm font-bold tabular-nums ${theme.accentText}`}>{eta}</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSimRunning(true)}
                  disabled={mode !== 'simulation' || simRunning}
                  className={`inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[12px] font-semibold
                    text-white transition ${theme.accentBg} hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  <Play className="w-4 h-4" /> 시작
                </button>
                <button
                  type="button"
                  onClick={() => setSimRunning(false)}
                  disabled={!simRunning}
                  className={`inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[12px] font-semibold
                    border ${theme.panelBorder} ${theme.textSecondary} ${theme.hoverBg} transition
                    disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  <Pause className="w-4 h-4" /> 중지
                </button>
              </div>
            </div>
          </Panel>

          {/* --- 작업자 메모 (작성 시각 기록) --- */}
          <Panel theme={theme}>
            <PanelTitle
              icon={StickyNote}
              title="작업자 메모"
              theme={theme}
              right={<span className={`text-[10px] tabular-nums ${theme.textFaint}`}>{memos.length}건</span>}
            />
            <div className="p-3 space-y-2">
              {memos.length > 0 && (
                <ol className={`max-h-44 overflow-y-auto rounded-lg border ${theme.panelBorder} ${theme.subtleBg} p-2.5 space-y-2.5`}>
                  {memos.map((m) => (
                    <li key={m.id} className={`border-b last:border-0 pb-2 last:pb-0 ${theme.divider}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`text-[10px] font-semibold tabular-nums ${theme.accentText}`}>
                          {fmtKoDateTime(m.at)}
                        </span>
                        <span className={`text-[9px] ${theme.textFaint}`}>백성열</span>
                      </div>
                      <p className={`mt-1 text-[11px] leading-relaxed whitespace-pre-wrap ${theme.textSecondary}`}>{m.text}</p>
                    </li>
                  ))}
                </ol>
              )}

              <textarea
                rows={3}
                value={memoDraft}
                onChange={(e) => setMemoDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitMemo();
                }}
                placeholder="현장 특이사항을 입력하세요. (Ctrl+Enter 저장)"
                className={`w-full rounded-lg border ${theme.panelBorder} ${theme.inputBg} p-2.5 text-[12px] leading-relaxed
                  ${theme.textPrimary} resize-none focus:outline-none focus:ring-2 ${theme.accentRing}`}
              />
              <div className="flex items-center justify-between">
                <span className={`text-[10px] tabular-nums ${theme.textGhost}`}>{memoDraft.length} / 500</span>
                <GhostButton icon={Save} theme={theme} onClick={submitMemo}>메모 저장</GhostButton>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </aside>
  );
};

/* ---------------------------------------------------------------------------
 * 8. 작업 추가 모달 — 카탈로그에서 선택 + 새 작업 설정 등록
 * ------------------------------------------------------------------------- */
const JobAddModal = ({ theme, templates, onAddTemplate, onAddJob, onClose }) => {
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? null);
  const [qty, setQty] = useState(templates[0]?.qty ?? 100);
  const [draft, setDraft] = useState({ name: '', qty: 100, minutes: 15 });
  const [error, setError] = useState('');

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const pick = (tpl) => {
    setSelectedId(tpl.id);
    setQty(tpl.qty);
  };

  const registerTemplate = () => {
    const name = draft.name.trim();
    if (!name) return setError('작업명을 입력하세요.');
    if (templates.some((t) => t.name === name)) return setError('이미 같은 이름의 작업이 있습니다.');
    const tpl = {
      id: `TPL-${String(templates.length + 1).padStart(2, '0')}`,
      name,
      qty: Math.max(1, Number(draft.qty) || 1),
      totalSec: Math.max(60, Math.round((Number(draft.minutes) || 1) * 60)),
    };
    onAddTemplate(tpl);
    setDraft({ name: '', qty: 100, minutes: 15 });
    setError('');
    pick(tpl);
  };

  return (
    <Modal theme={theme} onClose={onClose} className="w-[560px]">
      <header className={`flex items-center justify-between px-5 py-3.5 border-b ${theme.panelBorder} ${theme.accentBgSoft}`}>
        <div className="flex items-center gap-2">
          <Plus className={`w-4 h-4 ${theme.accentText}`} />
          <h3 className={`text-sm font-bold ${theme.textPrimary}`}>작업 추가</h3>
        </div>
        <button type="button" onClick={onClose} className={`grid place-items-center w-7 h-7 rounded-md ${theme.textMuted} ${theme.hoverBg}`} aria-label="닫기">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="max-h-[70vh] overflow-y-auto p-5 space-y-5">
        {/* 1) 카탈로그에서 선택 */}
        <section>
          <h4 className={`text-[11px] font-bold tracking-wider mb-2 ${theme.textMuted}`}>1. 작업 선택</h4>
          <ul className={`rounded-lg border ${theme.panelBorder} divide-y ${theme.divider} overflow-hidden`}>
            {templates.map((tpl) => (
              <li key={tpl.id}>
                <button
                  type="button"
                  onClick={() => pick(tpl)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                    ${selectedId === tpl.id ? theme.accentBgSoft : theme.hoverBg}`}
                >
                  <span
                    className={`grid place-items-center w-4 h-4 rounded-full border-2 shrink-0
                      ${selectedId === tpl.id ? `${theme.accentBg} border-transparent` : theme.panelBorder}`}
                  >
                    {selectedId === tpl.id && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[12px] font-medium truncate ${theme.textPrimary}`}>{tpl.name}</span>
                    <span className={`block text-[10px] tabular-nums ${theme.textFaint}`}>
                      {tpl.id} · 기본 {tpl.qty} EA · 표준 {fmtDuration(tpl.totalSec)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-end gap-2">
            <label className="flex-1">
              <span className={`block text-[11px] mb-1 ${theme.textMuted}`}>수량 (EA)</span>
              <input
                type="number" min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                className={`w-full h-9 px-3 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
                  text-sm tabular-nums ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}`}
              />
            </label>
            <button
              type="button"
              disabled={!selected}
              onClick={() => { onAddJob(selected, qty); onClose(); }}
              className={`h-9 px-5 rounded-lg text-[12px] font-bold text-white ${theme.accentBg}
                hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              대기열에 추가
            </button>
          </div>
        </section>

        {/* 2) 새 작업 설정 등록 */}
        <section className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} p-3.5`}>
          <h4 className={`text-[11px] font-bold tracking-wider mb-2.5 ${theme.textMuted}`}>2. 새 작업 설정 등록</h4>
          <div className="grid grid-cols-[1fr_84px_96px] gap-2">
            <label>
              <span className={`block text-[10px] mb-1 ${theme.textFaint}`}>작업명</span>
              <input
                value={draft.name}
                onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setError(''); }}
                placeholder="예: HPG 실린더 리크 검사"
                className={`w-full h-9 px-3 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
                  text-[12px] ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}`}
              />
            </label>
            <label>
              <span className={`block text-[10px] mb-1 ${theme.textFaint}`}>수량</span>
              <input
                type="number" min={1}
                value={draft.qty}
                onChange={(e) => setDraft({ ...draft, qty: e.target.value })}
                className={`w-full h-9 px-2 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
                  text-[12px] text-right tabular-nums ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}`}
              />
            </label>
            <label>
              <span className={`block text-[10px] mb-1 ${theme.textFaint}`}>표준시간(분)</span>
              <input
                type="number" min={1}
                value={draft.minutes}
                onChange={(e) => setDraft({ ...draft, minutes: e.target.value })}
                className={`w-full h-9 px-2 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
                  text-[12px] text-right tabular-nums ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}`}
              />
            </label>
          </div>
          {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
          <div className="mt-2.5 flex justify-end">
            <GhostButton icon={Plus} theme={theme} onClick={registerTemplate} className="px-3">
              작업 목록에 등록
            </GhostButton>
          </div>
        </section>
      </div>
    </Modal>
  );
};

/* ---------------------------------------------------------------------------
 * 8-2. 엑셀 업로드 모달
 *   업로드 → 검증 → 미리보기 → 확정. 파일을 바로 대기열에 밀어넣지 않고
 *   행별 검증 결과를 먼저 보여준 뒤 사용자가 선택한 행만 반영한다.
 * ------------------------------------------------------------------------- */
const ExcelUploadModal = ({ theme, existingNames, onImport, onClose }) => {
  const [state, setState] = useState({ status: 'idle' }); // idle | parsing | done | error
  const [checked, setChecked] = useState(new Set());
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setState({ status: 'parsing', fileName: file.name });
    try {
      const result = await parseJobWorkbook(file, existingNames);
      setState({ status: 'done', fileName: file.name, ...result });
      setChecked(new Set(result.rows.filter((r) => r.valid).map((r) => r.excelRow)));
    } catch (e) {
      setState({ status: 'error', fileName: file.name, message: e?.message ?? '파일을 읽을 수 없습니다.' });
    }
  };

  const rows = state.rows ?? [];
  const validCount = rows.filter((r) => r.valid).length;
  const errorCount = rows.length - validCount;
  const selected = rows.filter((r) => checked.has(r.excelRow));

  const toggle = (row) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(row.excelRow)) next.delete(row.excelRow);
      else next.add(row.excelRow);
      return next;
    });

  return (
    <Modal theme={theme} onClose={onClose} className="w-[780px]">
      <header className={`flex items-center justify-between px-5 py-3.5 border-b ${theme.panelBorder} ${theme.accentBgSoft}`}>
        <div className="flex items-center gap-2">
          <Upload className={`w-4 h-4 ${theme.accentText}`} />
          <h3 className={`text-sm font-bold ${theme.textPrimary}`}>엑셀 업로드</h3>
          {state.sheetName && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] border ${theme.chip}`}>시트: {state.sheetName}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <GhostButton icon={FileDown} theme={theme} onClick={downloadJobTemplate} className="px-2">
            양식 다운로드
          </GhostButton>
          <button type="button" onClick={onClose} className={`grid place-items-center w-7 h-7 rounded-md ${theme.textMuted} ${theme.hoverBg}`} aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="max-h-[70vh] overflow-y-auto p-5 space-y-4">
        {/* 드롭존 */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
          onClick={() => inputRef.current?.click()}
          className={`grid place-items-center h-28 rounded-xl border-2 border-dashed cursor-pointer transition-colors
            ${dragOver ? theme.accentBgSoft : theme.subtleBg} ${theme.panelBorder}`}
          style={dragOver ? { borderColor: theme.accentHex } : undefined}
        >
          <div className="text-center">
            <Upload className={`w-6 h-6 mx-auto ${theme.accentText}`} />
            <p className={`mt-2 text-[12px] font-medium ${theme.textPrimary}`}>
              {state.fileName ?? '엑셀 파일을 여기에 놓거나 클릭해서 선택'}
            </p>
            <p className={`mt-0.5 text-[10px] ${theme.textFaint}`}>.xlsx · .xls · .csv</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>

        {/* 필요한 컬럼 안내 */}
        <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2 text-[11px]`}>
          <span className={theme.textMuted}>필수 컬럼 </span>
          <span className={`font-semibold ${theme.textPrimary}`}>{REQUIRED_COLUMNS.join(' · ')}</span>
          <span className={`ml-3 ${theme.textMuted}`}>선택 </span>
          <span className={theme.textSecondary}>{OPTIONAL_COLUMNS.join(' · ')}</span>
        </div>

        {state.status === 'error' && (
          <p className="text-[12px] text-red-500">파일을 읽지 못했습니다 — {state.message}</p>
        )}

        {state.status === 'done' && state.missingRequired?.length > 0 && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5">
            <p className="text-[12px] font-semibold text-red-500">필수 컬럼을 찾지 못했습니다</p>
            <p className={`mt-1 text-[11px] ${theme.textSecondary}`}>
              누락: {state.missingRequired.join(', ')}
              {state.unmatched?.length > 0 && ` · 인식되지 않은 헤더: ${state.unmatched.slice(0, 6).join(', ')}`}
            </p>
            <p className={`mt-1 text-[10px] ${theme.textFaint}`}>
              양식 다운로드로 받은 파일의 헤더명을 사용하면 확실합니다.
            </p>
          </div>
        )}

        {/* 미리보기 */}
        {state.status === 'done' && rows.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className={`text-[11px] font-bold tracking-wider ${theme.textMuted}`}>
                미리보기 · 총 {rows.length}행
                <span className="ml-2 text-emerald-500">정상 {validCount}</span>
                {errorCount > 0 && <span className="ml-2 text-red-500">오류 {errorCount}</span>}
              </h4>
              <button
                type="button"
                onClick={() =>
                  setChecked((prev) =>
                    prev.size === validCount ? new Set() : new Set(rows.filter((r) => r.valid).map((r) => r.excelRow))
                  )
                }
                className={`text-[10px] ${theme.textMuted} hover:underline`}
              >
                정상 행 전체 {checked.size === validCount ? '해제' : '선택'}
              </button>
            </div>

            <div className={`rounded-lg border ${theme.panelBorder} overflow-hidden`}>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className={`sticky top-0 ${theme.headerBg}`}>
                    <tr className={`border-b ${theme.divider}`}>
                      {['', '행', '작업명', '수량', '표준시간', '설비', '검증'].map((h) => (
                        <th key={h} className={`px-2 py-1.5 text-left font-semibold ${theme.textMuted}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.excelRow}
                        className={`border-b last:border-0 ${theme.divider} ${r.valid ? '' : 'bg-red-500/5'}`}
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={checked.has(r.excelRow)}
                            disabled={!r.valid}
                            onChange={() => toggle(r)}
                            className="accent-sky-500 disabled:opacity-30"
                          />
                        </td>
                        <td className={`px-2 py-1.5 tabular-nums ${theme.textFaint}`}>{r.excelRow}</td>
                        <td className={`px-2 py-1.5 ${theme.textPrimary}`}>{r.name || <span className="text-red-500">—</span>}</td>
                        <td className={`px-2 py-1.5 tabular-nums ${theme.textSecondary}`}>{r.qty || '—'}</td>
                        <td className={`px-2 py-1.5 tabular-nums ${theme.textSecondary}`}>{r.minutes ? `${r.minutes}분` : '—'}</td>
                        <td className={`px-2 py-1.5 ${theme.textFaint}`}>{r.equipment || '—'}</td>
                        <td className="px-2 py-1.5">
                          {r.valid
                            ? <span className="text-emerald-500">정상</span>
                            : <span className="text-red-500">{r.errors.join(', ')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>

      <footer className={`flex items-center justify-between px-5 py-3 border-t ${theme.panelBorder} ${theme.subtleBg}`}>
        <span className={`text-[11px] ${theme.textMuted}`}>
          {selected.length > 0 ? `${selected.length}개 작업이 대기열에 추가됩니다.` : '추가할 행을 선택하세요.'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`h-9 px-4 rounded-lg border ${theme.panelBorder} text-[12px] font-semibold ${theme.textSecondary} ${theme.hoverBg}`}
          >
            취소
          </button>
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => { onImport(selected); onClose(); }}
            className={`h-9 px-5 rounded-lg text-[12px] font-bold text-white ${theme.accentBg}
              hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            대기열에 추가
          </button>
        </div>
      </footer>
    </Modal>
  );
};

/* ---------------------------------------------------------------------------
 * 9. CCTV 확대 모달
 * ------------------------------------------------------------------------- */
const CctvModal = ({ theme, cam, now, onClose }) => (
  <Modal theme={theme} onClose={onClose} className="w-[880px]">
    <header className={`flex items-center justify-between px-4 py-3 border-b ${theme.panelBorder}`}>
      <div className="flex items-center gap-2">
        <Video className={`w-4 h-4 ${theme.accentText}`} />
        <h3 className={`text-sm font-bold ${theme.textPrimary}`}>{cam.label}</h3>
        <span className={`px-1.5 py-0.5 rounded text-[10px] tabular-nums border ${theme.chip}`}>{cam.id}</span>
        <span className="flex items-center gap-1 text-[10px] text-red-500">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> REC
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-[11px] font-semibold tabular-nums ${theme.textSecondary}`}>{fmtDate(now)} {fmtClock(now)}</span>
        <button type="button" onClick={onClose} className={`grid place-items-center w-7 h-7 rounded-md ${theme.textMuted} ${theme.hoverBg}`} aria-label="닫기">
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
    <div className="relative bg-black">
      <video src={cam.src} className="w-full max-h-[70vh] object-contain" autoPlay muted loop playsInline controls />
      <div
        className="absolute inset-0 opacity-15 pointer-events-none mix-blend-overlay"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(0,0,0,.5) 0px, rgba(0,0,0,.5) 1px, transparent 1px, transparent 3px)',
        }}
      />
    </div>
  </Modal>
);

/* ---------------------------------------------------------------------------
 * 10. E-STOP 확인 모달
 * ------------------------------------------------------------------------- */
const EStopModal = ({ theme, engaged, plantName, onConfirm, onCancel }) => (
  <Modal theme={theme} onClose={onCancel} className="w-[380px]">
    <div className="p-6">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-red-500/15 text-red-500">
          <AlertOctagon className="w-6 h-6" />
        </span>
        <div>
          <h3 className={`text-base font-bold ${theme.textPrimary}`}>{engaged ? '비상 정지 해제' : '비상 정지 실행'}</h3>
          <p className={`text-[11px] mt-0.5 ${theme.textMuted}`}>{plantName}</p>
        </div>
      </div>
      <p className={`mt-4 text-[12px] leading-relaxed ${theme.textSecondary}`}>
        {engaged
          ? '라인 전 설비의 인터록을 해제하고 운전 대기 상태로 복귀합니다. 현장 안전이 확보되었는지 확인하세요.'
          : '해당 라인의 모든 설비가 즉시 정지되며, 진행 중인 작업 지시는 보류됩니다. 계속하시겠습니까?'}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={`h-10 rounded-lg border ${theme.panelBorder} text-[12px] font-semibold ${theme.textSecondary} ${theme.hoverBg}`}
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="h-10 rounded-lg bg-red-600 hover:bg-red-500 text-[12px] font-bold text-white"
        >
          {engaged ? '해제 확인' : '즉시 정지'}
        </button>
      </div>
    </div>
  </Modal>
);

/* ---------------------------------------------------------------------------
 * 11. Root
 * ------------------------------------------------------------------------- */
export default function DigitalTwinDashboard() {
  const [appearance, setAppearance] = useState('dark');
  const [mode, setMode] = useState('operation');
  const [plant, setPlant] = useState(PLANTS[0].id);
  const [jobs, setJobs] = useState(INITIAL_JOBS);
  const [templates, setTemplates] = useState(INITIAL_JOB_TEMPLATES);
  const [speed, setSpeed] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [eStopEngaged, setEStopEngaged] = useState(false);

  /* 모달 */
  const [eStopModal, setEStopModal] = useState(false);
  const [jobAddModal, setJobAddModal] = useState(false);
  const [excelModal, setExcelModal] = useState(false);
  const [expandedCam, setExpandedCam] = useState(null);

  /* 설비별 배치 오프셋 / 메모 */
  const [offsets, setOffsets] = useState(() =>
    Object.fromEntries(FACTORY_ASSETS.map((a) => [a.id, [...a.offset]]))
  );
  const [memos, setMemos] = useState({});

  const theme = getTheme(appearance, mode);
  const currentJob = jobs[0] ?? null;
  const selectedAsset = useMemo(() => findAsset(selectedId), [selectedId]);
  const plantName = PLANTS.find((p) => p.id === plant)?.name ?? '';

  const now = useWallClock();
  const elapsed = useJobTimer({
    totalSec: currentJob?.totalSec ?? 900,
    speed: mode === 'simulation' ? speed : 1,
    paused: eStopEngaged,
  });

  const handleModeChange = (next) => {
    setMode(next);
    if (next === 'operation') setSpeed(1);
  };

  /* 3D 기즈모 드래그가 끝날 때 한 번 호출된다 */
  const handleMove = (id, position) => setOffsets((prev) => ({ ...prev, [id]: position }));

  const handleOffsetReset = (id) =>
    setOffsets((prev) => ({ ...prev, [id]: [...(findAsset(id)?.offset ?? [0, 0, 0])] }));

  const handleAddMemo = (assetId, text) =>
    setMemos((prev) => ({
      ...prev,
      [assetId]: [{ id: Date.now(), at: new Date(), text }, ...(prev[assetId] ?? [])],
    }));

  /** 엑셀에서 선택된 행들을 대기열에 일괄 추가하고, 카탈로그에도 없으면 등록한다 */
  const handleImportExcel = (rows) => {
    setJobs((prev) => [
      ...prev,
      ...rows.map((r, i) => ({
        id: `WO-2607-${String(prev.length + i + 1).padStart(3, '0')}`,
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

  const handleAddJob = (tpl, qty) =>
    setJobs((prev) => [
      ...prev,
      {
        id: `WO-2607-${String(prev.length + 1).padStart(3, '0')}`,
        name: tpl.name,
        qty,
        totalSec: tpl.totalSec,
        state: 'IDLE',
      },
    ]);

  return (
    <div className={`w-screen h-screen overflow-hidden flex flex-col font-sans ${theme.appBg} ${theme.textSecondary} transition-colors duration-300`}>
      {/* 시뮬레이션 / E-STOP 전역 프레임 */}
      <div
        className={`pointer-events-none fixed inset-0 z-40 ring-2 ring-inset transition-all duration-500
          ${eStopEngaged ? 'ring-red-500/70' : theme.frameRing}`}
      />

      <TopGnb
        theme={theme}
        mode={mode}
        onModeChange={handleModeChange}
        plant={plant}
        onPlantChange={setPlant}
        eStopEngaged={eStopEngaged}
        onEStop={() => setEStopModal(true)}
        now={now}
        simElapsed={elapsed}
        speed={speed}
        appearance={appearance}
        onToggleAppearance={() => setAppearance((a) => (a === 'dark' ? 'light' : 'dark'))}
      />

      <div className="relative flex-1 min-h-0 flex">
        <LeftDashboardPanel
          theme={theme}
          mode={mode}
          jobs={jobs}
          onRemoveJob={(id) => setJobs((prev) => prev.filter((j) => j.id !== id))}
          onOpenJobAdd={() => setJobAddModal(true)}
          onOpenExcel={() => setExcelModal(true)}
          speed={speed}
          onSpeedChange={setSpeed}
          currentJob={currentJob}
          elapsed={elapsed}
          now={now}
        />

        <TwinViewport
          theme={theme}
          mode={mode}
          selectedId={selectedId}
          selectedAsset={selectedAsset}
          onSelect={setSelectedId}
          offsets={offsets}
          onMove={handleMove}
          onOffsetReset={handleOffsetReset}
          now={now}
          simElapsed={elapsed}
          speed={speed}
          onExpandCam={setExpandedCam}
        />

        <AssetDetailSidebar
          theme={theme}
          mode={mode}
          asset={selectedAsset}
          onClose={() => setSelectedId(null)}
          now={now}
          memos={memos[selectedId] ?? []}
          onAddMemo={handleAddMemo}
        />
      </div>

      {/* 하단 스테이터스 바 */}
      <footer
        className={`h-7 shrink-0 flex items-center justify-between px-4 border-t ${theme.panelBorder}
          ${theme.headerBg} text-[10px] tabular-nums ${theme.textFaint}`}
      >
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> OPC-UA 연결됨
          </span>
          <span>Latency 24ms</span>
          <span>Sync {fmtDate(now)} {fmtClock(now)}</span>
        </div>
        <div className="flex items-center gap-4">
          <span>선택 가능 설비 {SELECTABLE_ASSETS.length}대</span>
          <span>{mode === 'simulation' ? `SIM ${speed.toFixed(1)}x` : 'REALTIME 1.0x'}</span>
          <span>{plantName}</span>
        </div>
      </footer>

      {eStopModal && (
        <EStopModal
          theme={theme}
          engaged={eStopEngaged}
          plantName={plantName}
          onCancel={() => setEStopModal(false)}
          onConfirm={() => { setEStopEngaged((v) => !v); setEStopModal(false); }}
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
    </div>
  );
}
