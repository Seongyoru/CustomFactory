/**
 * =============================================================================
 *  상단 GNB — 로고 / 라인 선택 / 모드 토글 / 시계 / 테마 / E-STOP / 프로필
 * =============================================================================
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Activity, AlertOctagon, BarChart3, ChevronDown, Cpu, Factory, GraduationCap, LayoutGrid, LogOut, Moon, Siren, Sun, User, Volume2, VolumeX,
} from 'lucide-react';
import { PRODUCTION_LINES } from '../../data/factoryAssets.js';
import { ROLES } from '../../auth/auth.js';
import { fmtClock, fmtDuration, fmtSpeed } from '../../lib/format.js';
import { BrandLogo } from '../ui.jsx';
import AlarmCenter from './AlarmCenter.jsx';

const PLANTS = PRODUCTION_LINES;

const TopGnb = ({
  theme, mode, onModeChange, plant, onPlantChange,
  eStopEngaged, onEStop, eStopAllowed = true, eStopHint,
  now, simElapsed, speed,
  appearance, onToggleAppearance, onFaultTest, faultTestAllowed = true, faultTestHint,
  onOpenReport, user, onLogout, onStartTutorial,
  view = 'line', onViewChange,
  alarms = [], onAlarmGoTo, onAlarmClear, canClearAlarm = true, clearAlarmHint,
  soundOn = true, onToggleSound,
}) => {
  /* 프로필 드롭다운 — 바깥 클릭으로 닫힌다 */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  return (
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

      {/* 전 라인 관제 뷰 전환 — 라인 선택 옆이 '어디를 보고 있는가'의 자리다 */}
      <button
        type="button"
        data-tour="overview"
        onClick={() => onViewChange?.(view === 'overview' ? 'line' : 'overview')}
        title={view === 'overview' ? '선택된 라인의 3D 상세로 돌아갑니다' : '전 라인 관제 화면을 엽니다'}
        className={`flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[11px] font-semibold whitespace-nowrap
          transition-colors focus:outline-none focus:ring-2 ${theme.accentRing}
          ${view === 'overview'
            ? `${theme.accentBg} text-white border-transparent`
            : `${theme.panelBorder} ${theme.textSecondary} ${theme.hoverBg}`}`}
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        전체 현황
      </button>

      <div className="relative" data-tour="line">
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

    {/* --- 중앙: 오류 테스트 + 운전 / 시뮬레이션 토글 --- */}
    <div className="flex items-center gap-2.5">
      {/* 개발/데모용 — 실제 연동 시에는 OPC-UA 알람 수신으로 대체된다.
          해제는 알림 센터에서 건별로 한다 (다중 알람 큐) */}
      <button
        type="button"
        data-tour="fault"
        onClick={onFaultTest}
        disabled={!faultTestAllowed}
        title={!faultTestAllowed ? faultTestHint : '설비 오류 상황을 임의로 1건 발생시킵니다 (해제는 알림 센터)'}
        className={`flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[11px] font-semibold whitespace-nowrap
          transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/40
          disabled:opacity-30 disabled:cursor-not-allowed
          ${theme.panelBorder} ${theme.textMuted} ${theme.hoverBg}`}
      >
        <Siren className="w-3.5 h-3.5" />
        오류 상황 테스트
      </button>

      <div className={`relative flex items-center p-1 rounded-full border ${theme.panelBorder} ${theme.subtleBg}`} data-tour="mode">
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
    </div>

    {/* --- 우: 리포트 + 시계 + 테마 + E-STOP + 프로필 --- */}
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        data-tour="report"
        onClick={onOpenReport}
        title="생산 리포트 · 알람 이력 · 작업 로그"
        className={`flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[11px] font-semibold whitespace-nowrap
          transition-colors ${theme.panelBorder} ${theme.textSecondary} ${theme.hoverBg}
          focus:outline-none focus:ring-2 ${theme.accentRing}`}
      >
        <BarChart3 className={`w-3.5 h-3.5 ${theme.accentText}`} />
        리포트
      </button>

      <div className={`hidden xl:flex flex-col items-end leading-none px-3 py-1 rounded-lg border ${theme.panelBorder} ${theme.subtleBg}`}>
        <span className={`flex items-center gap-1 text-[9px] font-bold tracking-widest ${theme.textFaint}`}>
          {mode === 'operation' ? (
            <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />LIVE</>
          ) : (
            <><span className="w-1.5 h-1.5 rounded-full bg-fuchsia-500" />SIM ×{fmtSpeed(speed)}</>
          )}
        </span>
        <span className={`mt-1 text-sm font-bold tabular-nums ${theme.textPrimary}`}>
          {mode === 'operation' ? fmtClock(now) : `T+ ${fmtDuration(simElapsed)}`}
        </span>
      </div>

      {/* 알림 센터 — 활성 알람 큐 */}
      <AlarmCenter
        theme={theme}
        alarms={alarms}
        onGoTo={onAlarmGoTo}
        onClear={onAlarmClear}
        canClear={canClearAlarm}
        clearHint={clearAlarmHint}
      />

      {/* 사운드 — 알람·완료·E-STOP 청각 피드백 */}
      <button
        type="button"
        onClick={onToggleSound}
        title={soundOn ? '알림음 끄기' : '알림음 켜기 (알람·로트 완료·비상 정지)'}
        aria-label="알림음"
        className={`grid place-items-center w-9 h-9 rounded-lg border ${theme.panelBorder} ${theme.subtleBg}
          ${soundOn ? theme.textSecondary : theme.textGhost} ${theme.hoverBg} transition-colors`}
      >
        {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
      </button>

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
        data-tour="estop"
        onClick={onEStop}
        disabled={!eStopAllowed}
        title={!eStopAllowed ? eStopHint : undefined}
        className={`group flex items-center gap-2 h-10 px-4 rounded-lg font-extrabold text-[13px] tracking-tight
          text-white border-b-4 active:border-b-0 active:translate-y-[3px] transition-all
          focus:outline-none focus:ring-4 focus:ring-red-500/40
          disabled:opacity-50 disabled:cursor-not-allowed disabled:active:border-b-4 disabled:active:translate-y-0
          ${eStopEngaged
            ? 'bg-red-700 border-red-900 animate-pulse'
            : 'bg-red-600 hover:bg-red-500 border-red-800 shadow-[0_0_20px_-4px_rgba(239,68,68,0.7)]'}`}
      >
        <AlertOctagon className="w-5 h-5" />
        {eStopEngaged ? 'E-STOP 작동 중' : '비상 정지'}
      </button>

      <div className={`h-6 w-px ${theme.dividerStrong}`} />

      {/* 프로필 + 로그아웃 드롭다운 */}
      <div className="relative" ref={menuRef} data-tour="profile">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className={`flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg ${theme.hoverBg}`}
        >
          <span className={`grid place-items-center w-7 h-7 rounded-full ${theme.accentBg} text-white`}>
            <User className="w-4 h-4" />
          </span>
          <span className="text-left leading-none hidden lg:block">
            <span className={`block text-[11px] font-semibold ${theme.textSecondary}`}>{user?.name ?? '-'}</span>
            <span className={`block text-[10px] mt-0.5 ${theme.textFaint}`}>
              {ROLES[user?.role]?.label ?? '-'}
            </span>
          </span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''} ${theme.textFaint}`} />
        </button>

        {menuOpen && (
          <div
            className={`anim-drop absolute right-0 top-full mt-1.5 w-48 rounded-lg border ${theme.panelBorder}
              ${theme.headerBg} shadow-2xl overflow-hidden z-50`}
          >
            <div className={`px-3 py-2.5 border-b ${theme.divider}`}>
              <p className={`text-[12px] font-semibold ${theme.textPrimary}`}>{user?.name}</p>
              <p className={`text-[10px] mt-0.5 ${theme.textFaint}`}>{ROLES[user?.role]?.label}</p>
            </div>
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onStartTutorial?.(); }}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium
                ${theme.textSecondary} ${theme.hoverBg} transition-colors border-b ${theme.divider}`}
            >
              <GraduationCap className="w-3.5 h-3.5" />
              튜토리얼 다시 보기
            </button>
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onLogout?.(); }}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium
                text-red-500 hover:bg-red-500/10 transition-colors`}
            >
              <LogOut className="w-3.5 h-3.5" />
              로그아웃
            </button>
          </div>
        )}
      </div>
    </div>
  </header>
  );
};

export default TopGnb;
