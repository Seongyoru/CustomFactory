/**
 * =============================================================================
 *  튜토리얼 오버레이 — 처음 접속한 사람을 위한 화면 안내 투어
 * =============================================================================
 *  data-tour 속성이 붙은 실제 화면 요소를 스포트라이트로 비추며 순서대로 설명한다.
 *  - 대상 요소가 없으면(권한으로 숨김 등) 그 단계는 자동으로 건너뛴다
 *  - 완료/건너뛰기는 localStorage 에 저장되어 다시 뜨지 않는다
 *    (GNB 프로필 메뉴 → '튜토리얼 다시 보기'로 언제든 재실행)
 * ---------------------------------------------------------------------------
 */
import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, GraduationCap, X } from 'lucide-react';

const STEPS = [
  {
    target: '[data-tour="viewport"]',
    title: '3D 디지털 트윈',
    body: '공장을 그대로 옮긴 3D 화면입니다. 좌클릭 드래그로 회전, 휠로 확대, 우클릭 드래그로 이동합니다. 설비를 클릭하면 상세 정보가 열리고, 좌상단 "설비 바로가기"로 카메라를 바로 보낼 수도 있습니다.',
  },
  {
    target: '[data-tour="line"]',
    title: '생산 라인 선택',
    body: '라인을 전환하면 카메라가 해당 라인으로 이동합니다. 대기열·진행률·비상 정지가 라인마다 독립적으로 돌아가므로, 보고 있지 않은 라인도 계속 생산 중입니다.',
  },
  {
    target: '[data-tour="progress"]',
    title: '생산 라인 진행률',
    body: '현재 로트의 진행률과 금일 누적 생산량입니다. 이 공정은 원자재 1개가 라인 전체를 통과하는 1세트 단위 공정이라, 로트가 표준시간을 채우면 자동으로 완료되고 다음 로트가 올라옵니다.',
  },
  {
    target: '[data-tour="queue"]',
    title: '생산 오더(로트) 대기열',
    body: '작업지시는 로트 = 품목 + 수량 단위입니다. 표준시간은 수량 × 품목 택트타임으로 자동 계산됩니다. 로트 추가·엑셀 업로드·취소를 여기서 하고, 행을 드래그하면 생산 순서를 바꿀 수 있습니다(운영자 이상).',
  },
  {
    target: '[data-tour="speed"]',
    title: '시뮬레이션 배속',
    body: '배속을 올리면 경과시간·3D 설비 동작·시간당 처리량이 함께 빨라집니다. 몇 시간치 생산을 몇 분 만에 돌려볼 수 있습니다.',
  },
  {
    target: '[data-tour="line-sim"]',
    title: '라인 시뮬레이션',
    body: '대기열의 모든 로트를 현재 배속으로 돌렸을 때의 완료 시각·총 생산량·예상 불량을 미리 계산해 줍니다. 실제 라인 상태에는 영향이 없으며, 시뮬레이션 모드에서 사용할 수 있습니다.',
  },
  {
    target: '[data-tour="asset-quick"]',
    title: '설비 상세 · 병목 분석',
    body: '설비를 클릭하거나 이 목록에서 선택하면 상세 패널이 열립니다. 실시간 센서와 함께 병목 분석을 볼 수 있는데, 라인 1사이클에서 각 설비가 실제로 움직이는 시간을 비교해 라인 속도를 결정하는 병목 설비를 알려줍니다.',
  },
  {
    target: '[data-tour="mode"]',
    title: '운전 / 시뮬레이션 모드',
    body: '운전 모드는 실시간(1배속)으로 현장을 보는 화면이고, 시뮬레이션 모드는 배속을 걸어 실험하는 화면입니다. 색상 테마도 함께 바뀝니다.',
  },
  {
    target: '[data-tour="fault"]',
    title: '오류 상황 테스트',
    body: '설비 오류 알람을 임의로 발생시키는 데모 버튼입니다(운영자 이상). 알람 확인 → 해당 설비로 카메라 이동 → 실시간 센서 급등까지 이어지는 흐름을 볼 수 있습니다.',
  },
  {
    target: '[data-tour="estop"]',
    title: '비상 정지 (E-STOP)',
    body: '현재 선택된 라인의 모든 설비를 즉시 세웁니다. 작동은 누구나 할 수 있지만, 해제는 운영자 이상만 가능합니다. 정지 시간은 OEE 가동률에 반영됩니다.',
  },
  {
    target: '[data-tour="report"]',
    title: '리포트 센터',
    body: '생산 실적, 라인별 OEE, 알람 이력, 작업(감사) 로그를 확인하고 엑셀로 내보낼 수 있습니다.',
  },
  {
    target: '[data-tour="profile"]',
    title: '계정과 권한',
    body: '관리자·운영자·모니터링 세 역할이 있고 역할마다 조작 범위가 다릅니다. 이 메뉴에서 로그아웃하거나 튜토리얼을 다시 볼 수 있습니다.',
  },
];

const PAD = 6; // 스포트라이트 여백(px)
const CARD_W = 360;

const TutorialOverlay = ({ theme, onClose }) => {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState(null);

  const step = STEPS[idx];

  useEffect(() => {
    const el = document.querySelector(step.target);
    if (!el) {
      /* 대상이 없으면(권한으로 미표시 등) 조용히 다음으로 */
      if (idx < STEPS.length - 1) setIdx((i) => i + 1);
      else onClose();
      return undefined;
    }
    const update = () => setRect(el.getBoundingClientRect());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [idx, step.target, onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && idx < STEPS.length - 1) setIdx((i) => i + 1);
      if (e.key === 'ArrowLeft' && idx > 0) setIdx((i) => i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, onClose]);

  if (!rect) return null;

  /* 카드 배치 — 대상 아래 공간이 부족하면 위로, 좌우는 화면 안으로 클램프 */
  const CARD_H_GUESS = 190;
  const below = rect.bottom + PAD + CARD_H_GUESS < window.innerHeight;
  const cardTop = below ? rect.bottom + PAD + 10 : Math.max(12, rect.top - PAD - CARD_H_GUESS - 10);
  const cardLeft = Math.min(
    Math.max(12, rect.left + rect.width / 2 - CARD_W / 2),
    window.innerWidth - CARD_W - 12
  );

  const isLast = idx === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-label="화면 안내 튜토리얼">
      {/* 스포트라이트 — 대상만 밝게 두고 나머지를 어둡게. 그림자 한 방으로 뚫는다 */}
      <div
        className="absolute rounded-xl transition-all duration-300 ease-out pointer-events-none"
        style={{
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
          boxShadow: `0 0 0 9999px rgba(2, 6, 23, 0.72), 0 0 0 2px ${theme.accentHex}`,
        }}
      />

      {/* 설명 카드 */}
      <div
        className={`absolute rounded-xl border shadow-2xl ${theme.panelBorder} ${theme.headerBg}`}
        style={{ top: cardTop, left: cardLeft, width: CARD_W, transition: 'top 300ms ease, left 300ms ease' }}
      >
        <header className={`flex items-center justify-between px-4 py-3 border-b ${theme.divider}`}>
          <span className={`flex items-center gap-1.5 text-[12px] font-bold ${theme.textPrimary}`}>
            <GraduationCap className={`w-4 h-4 ${theme.accentText}`} />
            {step.title}
          </span>
          <span className={`text-[10px] tabular-nums ${theme.textFaint}`}>{idx + 1} / {STEPS.length}</span>
        </header>

        <p className={`px-4 py-3 text-[12px] leading-relaxed ${theme.textSecondary}`}>{step.body}</p>

        {/* 진행 점 */}
        <div className="flex items-center gap-1 px-4">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className="h-1 rounded-full transition-all duration-200"
              style={{
                width: i === idx ? 16 : 6,
                backgroundColor: i === idx ? theme.accentHex : 'currentColor',
                opacity: i === idx ? 1 : 0.2,
              }}
            />
          ))}
        </div>

        <footer className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className={`inline-flex items-center gap-1 text-[11px] ${theme.textFaint} hover:underline`}
          >
            <X className="w-3 h-3" /> 건너뛰기
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={idx === 0}
              onClick={() => setIdx((i) => i - 1)}
              className={`inline-flex items-center gap-1 h-8 px-3 rounded-lg border text-[11px] font-semibold
                ${theme.panelBorder} ${theme.textSecondary} ${theme.hoverBg}
                disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              <ArrowLeft className="w-3 h-3" /> 이전
            </button>
            <button
              type="button"
              onClick={() => (isLast ? onClose() : setIdx((i) => i + 1))}
              className={`inline-flex items-center gap-1 h-8 px-4 rounded-lg text-[11px] font-bold text-white
                ${theme.accentBg} hover:opacity-90`}
            >
              {isLast ? '시작하기' : '다음'} {!isLast && <ArrowRight className="w-3 h-3" />}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default TutorialOverlay;
