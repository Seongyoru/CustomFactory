/**
 * =============================================================================
 *  중앙 3D 뷰포트 — 씬 + 상태 HUD + 공정 시퀀스 HUD + CCTV PIP + 뷰 컨트롤
 * =============================================================================
 */
import React, { useRef, useState } from 'react';
import {
  Grid3x3, Layers, Maximize2, Move3d, RotateCcw, Video, Workflow,
} from 'lucide-react';
import FactoryScene, { CAMERA_HOME } from '../../scene/FactoryScene.jsx';
import {
  CONVEYOR_LOAD_MAX, SELECTABLE_ASSETS, cycleSecFor, findLine, processPhasesFor,
} from '../../data/factoryAssets.js';
import { CCTV_FEEDS } from '../../data/jobs.js';
import {
  fmtAnimScale, fmtClock, fmtDate, fmtDuration, fmtSec, fmtSpeed,
} from '../../lib/format.js';
import CctvVideo from '../CctvVideo.jsx';
import { usePersistentState } from '../../lib/persist.js';

/**
 * 공정 시퀀스 HUD 가 4Hz 로 갱신되는데, 그때마다 3D 트리까지 재조정되면 낭비다.
 * 씬에 넘기는 props 는 모두 참조가 안정적이라 memo 로 그 갱신을 끊어낸다.
 */
const Scene = React.memo(FactoryScene);

/* 좁은 화면(태블릿·폰)에선 HUD 가 3D 를 다 덮으므로 접힌 채 시작한다 — 토글은 그대로 */
const startOpenOnWide = () =>
  typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches;

const ProcessSequenceHud = ({ theme, processTime, animTimeScale, paused, repeats = CONVEYOR_LOAD_MAX }) => {
  const [open, setOpen] = useState(startOpenOnWide);
  /* 사이클 길이·단계는 현재 로드의 적재 수(반복 횟수)에 따라 달라진다 */
  const cycleSec = cycleSecFor(repeats);
  const phases = processPhasesFor(repeats);
  const pct = (t) => `${(t / cycleSec) * 100}%`;
  const active = phases.filter((p) => processTime >= p.start && processTime <= p.end);

  return (
    <div className={`w-[384px] max-w-[calc(100vw-32px)] rounded-lg border ${theme.panelBorder} ${theme.overlayBg} backdrop-blur-md ${theme.glow}`}>
      <header className={`flex items-center justify-between px-2.5 py-1.5 border-b ${theme.divider}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <Workflow className={`w-3.5 h-3.5 shrink-0 ${theme.accentText}`} />
          <span className={`text-[11px] font-semibold ${theme.textPrimary}`}>공정 시퀀스</span>
          <span className={`ml-1 px-1.5 py-0.5 rounded text-[9px] tabular-nums border ${theme.chip}`}>
            ×{fmtAnimScale(animTimeScale)}
          </span>
          <span className={`truncate text-[9px] ${theme.textFaint}`}>
            {paused ? '정지됨' : active.map((p) => p.label).join(' · ') || '대기'}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-bold tabular-nums ${theme.accentText}`}>{fmtSec(processTime)}</span>
          <button type="button" onClick={() => setOpen((v) => !v)} className={`text-[10px] px-1 ${theme.textMuted}`}>
            {open ? '접기' : '펼치기'}
          </button>
        </div>
      </header>

      {open && (
        <div className="relative p-2 space-y-1">
          {phases.map((p) => {
            const on = processTime >= p.start && processTime <= p.end;
            return (
              <div key={`${p.id}-${p.label}`} className="flex items-center gap-2">
                <span className={`w-[62px] shrink-0 text-[9px] truncate ${on ? theme.textPrimary : theme.textFaint}`}>
                  {p.label}
                </span>
                <span className={`relative flex-1 h-2.5 rounded-sm overflow-hidden ${theme.trackBg}`}>
                  <span
                    className="absolute inset-y-0 rounded-sm transition-opacity duration-150"
                    style={{
                      left: pct(p.start),
                      width: pct(p.end - p.start),
                      backgroundColor: theme.accentHex,
                      opacity: on ? 0.95 : 0.28,
                    }}
                  />
                </span>
                <span className={`w-[54px] shrink-0 text-right text-[9px] tabular-nums ${theme.textGhost}`}>
                  {p.start.toFixed(1)}–{p.end.toFixed(1)}
                </span>
              </div>
            );
          })}

          {/* 재생 헤드 — 라벨/시각 열을 빼고 트랙 영역에만 걸친다
              (좌: 패딩 8 + 라벨 62 + gap 8 = 78 / 우: 패딩 8 + 시각 54 + gap 8 = 70) */}
          <span
            className="pointer-events-none absolute top-2 bottom-2"
            style={{ left: 78, right: 70 }}
          >
            <span
              className="absolute top-0 bottom-0 w-px"
              style={{ left: pct(processTime), backgroundColor: theme.accentHex, opacity: 0.9 }}
            />
          </span>
        </div>
      )}
    </div>
  );
};

const TwinViewport = ({
  theme, mode, selectedId, selectedAsset, onSelect,
  offsets, offsetsByLine, onMove, onOffsetReset, now, simElapsed, speed, onExpandCam,
  animTimeScale, animByLine, animPaused, activeLineId, faults, focusRequest,
  onFocusAsset, dischargedByLine, cctvFeeds = CCTV_FEEDS,
  canAdjustLayout = true,
}) => {
  const controlsRef = useRef(null);
  const wrapperRef = useRef(null);
  /**
   * 3D 공정 애니메이션의 현재 사이클 시각(0~7.2s). 씬이 4Hz 로 올려준다.
   * 이 상태를 루트에 두면 초당 4번 대시보드 전체가 리렌더되므로 뷰포트에 가둔다.
   * 씬 자체도 이 틱에 휩쓸리지 않도록 memo 로 감싼 Scene 을 쓴다.
   */
  const [processTime, setProcessTime] = useState(0);
  const [cctvOpen, setCctvOpen] = useState(startOpenOnWide);
  const [showGrid, setShowGrid] = useState(true);
  const [showShell, setShowShell] = useState(true);
  const [shellOpacity, setShellOpacity] = useState(0.5);
  const [viewPanelOpen, setViewPanelOpen] = useState(false);
  /* 글로우 효과(블룸·비네트, 다크 전용) — 저사양에서 끌 수 있게 저장한다 */
  const [sceneFx, setSceneFx] = usePersistentState('ui.sceneFx', true);

  /* 홈 시점은 라인 1호기 기준이라, 선택된 라인 원점만큼 밀어서 되돌린다 */
  const resetCamera = () => {
    const c = controlsRef.current;
    if (!c) return;
    const [ox, oy, oz] = findLine(activeLineId).origin;
    c.object.position.set(
      CAMERA_HOME.position[0] + ox,
      CAMERA_HOME.position[1] + oy,
      CAMERA_HOME.position[2] + oz
    );
    c.target.set(
      CAMERA_HOME.target[0] + ox,
      CAMERA_HOME.target[1] + oy,
      CAMERA_HOME.target[2] + oz
    );
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
    /* lg 미만: 스택 최상단에 고정 높이로 — h-full 은 세로 스택에서 무의미해진다 */
    <main className="relative flex-1 min-w-0 h-full p-3 pl-0
      max-lg:order-1 max-lg:flex-none max-lg:w-full max-lg:h-[46vh] max-lg:min-h-[320px] max-lg:pl-3">
      <div
        ref={wrapperRef}
        data-tour="viewport"
        className={`relative w-full h-full rounded-xl overflow-hidden border ${theme.panelBorder} ${theme.glow}`}
        style={{ background: theme.scene.bgGradient ?? theme.scene.bg }}
      >
        <Scene
          selectedId={selectedId}
          onSelect={onSelect}
          activeLineId={activeLineId}
          showGrid={showGrid}
          showShell={showShell}
          shellOpacity={shellOpacity}
          offsetsByLine={offsetsByLine}
          onMove={canAdjustLayout ? onMove : undefined}
          animByLine={animByLine}
          onProcessTick={setProcessTime}
          faults={faults}
          focusRequest={focusRequest}
          dischargedByLine={dischargedByLine}
          theme={theme}
          controlsRef={controlsRef}
          fxEnabled={sceneFx}
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
            {canAdjustLayout && (
              <button
                type="button"
                onClick={() => onOffsetReset(selectedId)}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${theme.panelBorder} ${theme.textMuted} ${theme.hoverBg}`}
              >
                초기화
              </button>
            )}
          </div>
        )}

        {/* --- 좌상단 상태 HUD + 설비 빠른 이동 --- */}
        <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none max-w-[calc(100%-80px)] max-lg:flex-wrap">
          <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold border ${theme.chip}`}>
            {mode === 'simulation' ? `SIMULATION ×${fmtSpeed(speed)}` : 'LIVE'}
          </span>
          {/* 날짜+시각 박스는 폰에선 숨긴다 — 하단 상태바의 Sync 시각과 중복이고 좁아서 구겨진다 */}
          <span className={`max-sm:hidden flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold tabular-nums
            border ${theme.panelBorder} ${theme.overlayBg} ${theme.textPrimary} backdrop-blur-sm`}>
            {mode === 'operation' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
            {mode === 'operation' ? `${fmtDate(now)}  ${fmtClock(now)}` : `T+ ${fmtDuration(simElapsed)}`}
          </span>

          {/* 설비를 고르면 선택 + 카메라가 그 설비로 날아간다 (3D 클릭이 익숙지 않아도 접근 가능) */}
          <select
            value=""
            data-tour="asset-quick"
            onChange={(e) => { if (e.target.value) onFocusAsset?.(e.target.value); e.target.value = ''; }}
            title="설비를 선택하면 카메라가 해당 설비로 이동합니다"
            className={`pointer-events-auto h-[26px] px-2 rounded-md border text-[10px] font-semibold cursor-pointer
              ${theme.panelBorder} ${theme.overlayBg} ${theme.textSecondary} backdrop-blur-sm
              focus:outline-none focus:ring-2 ${theme.accentRing}`}
          >
            <option value="">설비 바로가기…</option>
            {SELECTABLE_ASSETS.map((a) => (
              <option key={a.id} value={a.id}>{a.name} · {a.nameKo}</option>
            ))}
          </select>
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

            {/* 글로우 효과(블룸·비네트) — 다크 테마 전용, 저사양이면 끈다 */}
            <div className={`mt-3 pt-3 border-t ${theme.divider} flex items-center justify-between`}>
              <span className={`text-[11px] ${theme.textMuted}`}>
                글로우 효과
                <span className={`ml-1 text-[9px] ${theme.textGhost}`}>다크 전용</span>
              </span>
              <button
                type="button"
                onClick={() => setSceneFx((v) => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors
                  ${sceneFx ? theme.accentBg : theme.trackBg}`}
                aria-label="글로우 효과"
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all
                    ${sceneFx ? 'left-[18px]' : 'left-0.5'}`}
                />
              </button>
            </div>
          </div>
        )}

        {/* --- 우하단 조작 안내 — 마우스 전제라 터치 화면(lg 미만)에선 숨긴다 --- */}
        <div className="absolute bottom-3 right-3 pointer-events-none max-lg:hidden">
          <p className={`rounded-md border ${theme.panelBorder} ${theme.overlayBg} px-2.5 py-1.5 text-[10px] leading-relaxed ${theme.textMuted} backdrop-blur-sm`}>
            좌클릭 드래그 <span className={theme.textPrimary}>회전</span> · 휠{' '}
            <span className={theme.textPrimary}>확대</span> · 우클릭 드래그{' '}
            <span className={theme.textPrimary}>이동</span> · 설비 클릭{' '}
            <span className={theme.textPrimary}>상세</span>
          </p>
        </div>

        {/* --- 좌하단 : 공정 시퀀스 HUD + CCTV PIP --- */}
        {/* 좁은 화면에선 HUD 스택 전체를 화면 폭 안으로 clamp */}
        <div className="absolute bottom-3 left-3 flex flex-col items-start gap-2 pointer-events-none max-w-[calc(100%-24px)]">
          <div className="pointer-events-auto">
            <ProcessSequenceHud
              theme={theme}
              processTime={processTime}
              animTimeScale={animTimeScale}
              paused={animPaused}
              repeats={animByLine?.[activeLineId]?.repeats}
            />
          </div>

          <div className={`pointer-events-auto max-w-full rounded-lg border ${theme.panelBorder} ${theme.overlayBg} backdrop-blur-md ${theme.glow}`}>
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
              <div className="flex gap-2 p-2 max-w-full overflow-x-auto">
                {cctvFeeds.map((cam) => (
                  <figure
                    key={cam.id}
                    className={`relative w-[184px] shrink-0 aspect-video rounded-md overflow-hidden border ${theme.panelBorder} bg-slate-950 group`}
                  >
                    <CctvVideo src={cam.src} variant="pip" />
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

export default TwinViewport;
