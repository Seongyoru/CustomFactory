/**
 * =============================================================================
 *  테마 토큰 — 2축 조합
 * =============================================================================
 *   appearance : 'dark' | 'light'   (사용자가 토글)
 *   mode       : 'operation' | 'simulation'
 *
 *  Tailwind 는 클래스 문자열을 정적으로 스캔하므로 `bg-${c}-500` 같은 동적 조합은
 *  빌드에서 누락됩니다. 그래서 4개 조합을 모두 "완성된 문자열"로 펼쳐 둡니다.
 *  accentHex / scene* 값은 three.js 로 넘어가는 실제 색상값입니다.
 * ---------------------------------------------------------------------------
 */

/* 다크 = 관제센터 무드 — 딥 네이비 바탕 + 포인트 컬러의 은은한 발광.
   순수 슬레이트 그레이보다 반 톤 푸른 배경이 '모니터링 룸' 인상을 만든다. */
const DARK_BASE = {
  appearance: 'dark',
  appBg: 'bg-[#04070f]',
  textPrimary: 'text-slate-100',
  textSecondary: 'text-slate-300',
  textMuted: 'text-slate-400',
  textFaint: 'text-slate-500',
  textGhost: 'text-slate-600',
  divider: 'border-white/5',
  dividerStrong: 'bg-white/10',
  hoverBg: 'hover:bg-white/5',
  inputBg: 'bg-black/40',
  subtleBg: 'bg-black/30',
  trackBg: 'bg-black/40',
  overlayBg: 'bg-black/70',
  cardBg: 'bg-black/20',
  /**
   * 3D 배경.
   *  bgGradient 는 캔버스 '뒤' DOM 에 칠하는 CSS 그라데이션이다 — 캔버스는 투명으로
   *  두고 이게 비쳐 보인다(three 만으로 그라데이션을 만들면 지오메트리가 필요해진다).
   *  fog 는 그라데이션의 중간 톤과 맞춰야 원경이 배경에 자연스럽게 녹는다.
   */
  /* 배경은 무채색(채도 0) 그레이 그라데이션 — 설비·상태 색이 더 또렷하게 선다 */
  scene: {
    bg: '#1c1c1c',
    bgGradient: 'linear-gradient(180deg, #3a3a3a 0%, #202020 55%, #141414 100%)',
    fog: '#242424',
    gridCell: '#464646',
  },
};

const LIGHT_BASE = {
  appearance: 'light',
  appBg: 'bg-slate-200',
  textPrimary: 'text-slate-900',
  textSecondary: 'text-slate-700',
  textMuted: 'text-slate-600',
  textFaint: 'text-slate-500',
  textGhost: 'text-slate-400',
  divider: 'border-slate-900/10',
  dividerStrong: 'bg-slate-900/15',
  hoverBg: 'hover:bg-slate-900/5',
  inputBg: 'bg-white',
  subtleBg: 'bg-slate-100',
  trackBg: 'bg-slate-300',
  overlayBg: 'bg-white/85',
  cardBg: 'bg-slate-50',
  scene: {
    bg: '#e4e4e4',
    bgGradient: 'linear-gradient(180deg, #f6f6f6 0%, #e6e6e6 55%, #d4d4d4 100%)',
    fog: '#e4e4e4',
    gridCell: '#b0b0b0',
  },
};

export const THEMES = {
  dark: {
    operation: {
      ...DARK_BASE,
      label: '운전 모드',
      headerBg: 'bg-[#0a1322]',
      panelBg: 'bg-[#0b1526]/85',
      panelBorder: 'border-[#24405f]/70',
      accentText: 'text-sky-400',
      accentBg: 'bg-sky-500',
      accentBgSoft: 'bg-sky-500/10',
      accentRing: 'focus:ring-sky-500/60',
      barFrom: 'from-sky-500',
      barTo: 'to-cyan-400',
      /* 핵심 패널에 포인트 컬러가 은은히 번지는 발광 — 관제 화면의 '전원 켜짐' 감각 */
      glow: 'shadow-[0_0_26px_-8px_rgba(56,189,248,0.35),0_0_0_1px_rgba(56,189,248,0.10)]',
      chip: 'bg-[#0e1b30] text-slate-300 border-[#24405f]',
      frameRing: 'ring-transparent',
      accentHex: '#38bdf8',
    },
    simulation: {
      ...DARK_BASE,
      label: '시뮬레이션 모드',
      headerBg: 'bg-[#140d24]',
      panelBg: 'bg-[#150e26]/85',
      panelBorder: 'border-fuchsia-500/35',
      accentText: 'text-fuchsia-400',
      accentBg: 'bg-fuchsia-500',
      accentBgSoft: 'bg-fuchsia-500/10',
      accentRing: 'focus:ring-fuchsia-500/60',
      barFrom: 'from-fuchsia-500',
      barTo: 'to-violet-400',
      glow: 'shadow-[0_0_24px_-6px_rgba(217,70,239,0.45)]',
      chip: 'bg-fuchsia-500/10 text-fuchsia-200 border-fuchsia-500/30',
      frameRing: 'ring-fuchsia-500/40',
      accentHex: '#d946ef',
    },
  },
  light: {
    operation: {
      ...LIGHT_BASE,
      label: '운전 모드',
      headerBg: 'bg-white',
      panelBg: 'bg-white/90',
      panelBorder: 'border-slate-300',
      accentText: 'text-sky-600',
      accentBg: 'bg-sky-600',
      accentBgSoft: 'bg-sky-50',
      accentRing: 'focus:ring-sky-500/50',
      barFrom: 'from-sky-500',
      barTo: 'to-cyan-500',
      glow: 'shadow-[0_1px_3px_rgba(15,23,42,0.12)]',
      chip: 'bg-slate-100 text-slate-600 border-slate-300',
      frameRing: 'ring-transparent',
      accentHex: '#0284c7',
    },
    simulation: {
      ...LIGHT_BASE,
      label: '시뮬레이션 모드',
      headerBg: 'bg-[#fdf4ff]',
      panelBg: 'bg-[#fdf4ff]/90',
      panelBorder: 'border-fuchsia-400/60',
      accentText: 'text-fuchsia-600',
      accentBg: 'bg-fuchsia-600',
      accentBgSoft: 'bg-fuchsia-50',
      accentRing: 'focus:ring-fuchsia-500/50',
      barFrom: 'from-fuchsia-500',
      barTo: 'to-violet-500',
      glow: 'shadow-[0_0_18px_-6px_rgba(192,38,211,0.5)]',
      chip: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300',
      frameRing: 'ring-fuchsia-500/40',
      accentHex: '#c026d3',
    },
  },
};

export const getTheme = (appearance, mode) => THEMES[appearance][mode];
