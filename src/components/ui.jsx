/**
 * =============================================================================
 *  공용 UI 프리미티브 — Panel / StatusLamp / GhostButton / Modal / BrandLogo
 * =============================================================================
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Boxes, Info } from 'lucide-react';

/**
 * 숫자 카운트업 — 값이 바뀌면 이전 표시값에서 새 값까지 0.6초 이징으로 굴러간다.
 *  숨김 탭(rAF 정지)에서는 즉시 스냅해 값이 뒤처지지 않는다.
 *  format 이 소수·단위를 결정한다 (기본: 정수 반올림).
 */
export const AnimatedNumber = ({ value, format = (v) => Math.round(v).toLocaleString(), durationMs = 600 }) => {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return undefined;
    if (typeof document !== 'undefined' && document.hidden) {
      fromRef.current = value;
      setShown(value);
      return undefined;
    }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / durationMs);
      const eased = 1 - (1 - p) ** 3;
      setShown(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      fromRef.current = value;
      setShown(value);
    };
  }, [value, durationMs]);
  return <>{format(shown)}</>;
};
import { STATUS } from '../data/factoryAssets.js';
import { assetUrl } from '../lib/baseUrl.js';

export const Panel = ({ theme, className = '', children, ...rest }) => (
  <section {...rest} className={`rounded-xl border ${theme.panelBorder} ${theme.panelBg} backdrop-blur-sm ${className}`}>
    {children}
  </section>
);

/**
 * 도움말 ⓘ — 올리면 즉시, 클릭하면 고정 토글로 뜨는 툴팁.
 *  브라우저 기본 title 툴팁은 1초쯤 지나야 뜨고 클릭에는 반응하지 않아
 *  "눌러도 아무 일 없다"로 읽혔다. 패널들이 스크롤 컨테이너 안에 있어
 *  말풍선은 fixed 로 띄우고 화면 가장자리에서는 안쪽으로 밀어 넣는다.
 */
const TOOLTIP_W = 264;
const TOOLTIP_EST_H = 150; // 플립 판단용 여유 높이 — 실제보다 크게 잡아 아래 잘림을 막는다
export const HintTip = ({ hint, theme }) => {
  /* null=닫힘. 좌표는 이벤트 핸들러에서 '동기적으로' 계산해 값으로 저장한다.
     setState 업데이터 안에서 e.currentTarget 을 읽으면, React 가 업데이터를 나중에
     실행할 때 이벤트가 이미 끝나 null 이라 앱 전체가 죽는다 (실배포에서 재현된 크래시). */
  const [pos, setPos] = useState(null); // {x, top?|bottom?, pinned}
  const openFrom = (el, pinned) => {
    const r = el.getBoundingClientRect();
    const half = TOOLTIP_W / 2;
    const x = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
    /* 아래 공간이 부족하면 아이콘 위로 띄운다 (bottom 기준 배치) */
    const below = r.bottom + TOOLTIP_EST_H <= window.innerHeight;
    setPos(
      below
        ? { x, top: r.bottom + 6, pinned }
        : { x, bottom: window.innerHeight - r.top + 6, pinned }
    );
  };

  /* fixed 배치라 스크롤/리사이즈하면 기준 좌표가 낡는다 — 그냥 닫는 게 정직하다 */
  const open = pos !== null;
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={(e) => { if (!open) openFrom(e.currentTarget, false); }}
      onMouseLeave={() => setPos((p) => (p?.pinned ? p : null))}
    >
      <button
        type="button"
        aria-label="도움말"
        onClick={(e) => {
          if (pos?.pinned) setPos(null);
          else openFrom(e.currentTarget.parentElement, true);
        }}
        onBlur={() => setPos(null)}
        className={`inline-flex cursor-help rounded-sm focus:outline-none focus:ring-1 ${theme.accentRing}`}
      >
        <Info className={`w-3 h-3 ${open ? theme.accentText : theme.textGhost}`} />
      </button>
      {open &&
        /* body 로 포털 — Panel 의 backdrop-filter 가 fixed 자손의 기준을 패널로
           바꿔버려(containing block), 툴팁이 엉뚱한 위치에 뜨고 뒤 패널에 가려졌다.
           body 직속이면 fixed 가 진짜 뷰포트 기준이고 스태킹도 패널 밖이다. */
        createPortal(
          <span
            role="tooltip"
            /* 패널과 확실히 구분되는 반전(다크) 말풍선 — 라이트/다크 테마 어디서나 대비가 선다.
               z-[90]: 사이드바(z-20)·모달(z-50) 위, 튜토리얼 오버레이(z-100) 아래 */
            className="anim-drop-centered fixed z-[90] -translate-x-1/2 rounded-lg border border-slate-600/50 bg-slate-900/95
              px-3 py-2 text-[11px] leading-relaxed text-slate-100 shadow-xl shadow-black/30 backdrop-blur-sm"
            style={{ left: pos.x, top: pos.top, bottom: pos.bottom, width: TOOLTIP_W }}
          >
            {hint}
          </span>,
          document.body
        )}
    </span>
  );
};

export const PanelTitle = ({ icon: Icon, title, right, theme, hint }) => (
  <header className={`flex items-center justify-between px-3 py-2.5 border-b ${theme.divider}`}>
    <div className="flex items-center gap-2">
      <Icon className={`w-4 h-4 ${theme.accentText}`} />
      <h2 className={`text-[13px] font-semibold tracking-tight ${theme.textPrimary}`}>{title}</h2>
      {/* 패널이 뭘 보여주는지 짧게 설명하는 도움말 — 올리거나 눌러서 본다 */}
      {hint && <HintTip hint={hint} theme={theme} />}
    </div>
    {right}
  </header>
);

export const StatusLamp = ({ state, size = 'sm', showLabel = true }) => {
  const s = STATUS[state] ?? STATUS.IDLE;
  const dot = size === 'lg' ? 'w-3.5 h-3.5' : 'w-2 h-2';
  return (
    /* shrink-0·nowrap — 옆의 긴 텍스트에 밀려 "작업\n중"으로 줄바꿈되지 않게 */
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
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

/** 모달 공통 셸 — 등장 시 팝 인 */
export const Modal = ({ theme, onClose, children, className = 'w-[460px]' }) => (
  <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
    <div
      className={`anim-pop ${className} max-h-full overflow-hidden rounded-2xl border ${theme.panelBorder} ${theme.headerBg} shadow-2xl`}
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
