/**
 * =============================================================================
 *  공용 UI 프리미티브 — Panel / StatusLamp / GhostButton / Modal / BrandLogo
 * =============================================================================
 */
import React, { useEffect, useState } from 'react';
import { Boxes, Info } from 'lucide-react';
import { STATUS } from '../data/factoryAssets.js';
import { assetUrl } from '../lib/baseUrl.js';

export const Panel = ({ theme, className = '', children, ...rest }) => (
  <section {...rest} className={`rounded-xl border ${theme.panelBorder} ${theme.panelBg} backdrop-blur-sm ${className}`}>
    {children}
  </section>
);

export const PanelTitle = ({ icon: Icon, title, right, theme, hint }) => (
  <header className={`flex items-center justify-between px-3 py-2.5 border-b ${theme.divider}`}>
    <div className="flex items-center gap-2">
      <Icon className={`w-4 h-4 ${theme.accentText}`} />
      <h2 className={`text-[13px] font-semibold tracking-tight ${theme.textPrimary}`}>{title}</h2>
      {/* 패널이 뭘 보여주는지 짧게 설명하는 도움말 — 아이콘에 올리면 뜬다 */}
      {hint && (
        <span title={hint} className="cursor-help inline-flex" aria-label={hint}>
          <Info className={`w-3 h-3 ${theme.textGhost}`} />
        </span>
      )}
    </div>
    {right}
  </header>
);

export const StatusLamp = ({ state, size = 'sm', showLabel = true }) => {
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

export const GhostButton = ({ icon: Icon, children, onClick, theme, danger = false, disabled = false, title, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`inline-flex items-center justify-center gap-1 rounded-md border px-1.5 py-1.5
      text-[11px] font-medium whitespace-nowrap transition-colors focus:outline-none focus:ring-2 ${theme.accentRing}
      disabled:opacity-30 disabled:cursor-not-allowed
      ${danger
        ? 'border-red-500/40 text-red-500 hover:bg-red-500/10'
        : `${theme.panelBorder} ${theme.textSecondary} ${theme.hoverBg}`} ${className}`}
  >
    {Icon && <Icon className="w-3.5 h-3.5" />}
    {children}
  </button>
);

export const ConsumableBar = ({ label, percent, theme }) => {
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
export const Modal = ({ theme, onClose, children, className = 'w-[460px]' }) => (
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
export const BrandLogo = ({ theme }) => {
  const [failed, setFailed] = useState(false);
  const logoUrl = assetUrl('/logo.png');

  useEffect(() => {
    const probe = new Image();
    probe.onerror = () => setFailed(true);
    probe.src = logoUrl;
  }, [logoUrl]);

  if (failed) {
    return (
      <div className={`grid place-items-center w-8 h-8 rounded-lg ${theme.accentBg}`}>
        <Boxes className="w-[18px] h-[18px] text-white" />
      </div>
    );
  }

  const mask = {
    WebkitMaskImage: `url(${logoUrl})`,
    maskImage: `url(${logoUrl})`,
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
