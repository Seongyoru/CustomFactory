/**
 * =============================================================================
 *  생산 오더(로트) 모델 — 품목 카탈로그 / 로트 발번 / 파이프라인 단계
 * =============================================================================
 *  이 라인은 6개 설비가 하나의 사이클로 묶인 '흐름 생산'이다. 그래서 작업지시는
 *  공정 단위가 아니라 **로트(품목 + 수량)** 단위다 — 로트의 1 EA 가 라인 1사이클을
 *  타고 개포장 → 이송 → 충전 → 검사 파이프라인을 순서대로 통과한다.
 *
 *  표준시간 = 수량 × 품목 택트타임(초/EA). 라인은 대기열 맨 위 로트부터 흘린다.
 * ---------------------------------------------------------------------------
 */
import { FACTORY_ASSETS, PRODUCTION_LINES } from './factoryAssets.js';

/**
 * 로트 번호 발번.
 *  대기열 '길이'로 번호를 만들면 취소 후 추가 시 이미 쓴 번호가 다시 나온다.
 *  지금까지 쓴 가장 큰 번호에서 이어 붙인다. (1호기 001~, 2호기 101~)
 */
export const makeLotId = (seq) => `LOT-2608-${String(seq).padStart(3, '0')}`;
export const nextLotSeq = (lots) =>
  lots.reduce((max, l) => Math.max(max, Number(String(l.id).split('-').pop()) || 0), 0) + 1;

/**
 * 품목 카탈로그 — '로트 추가' 팝업에서 선택하거나 새로 등록한다.
 *  taktSec 은 이 품목을 만들 때 라인 1사이클(제품 1개)에 걸리는 초.
 *  3D 애니메이션 재생 배속도 이 값에서 나온다 (7.2s 클립을 택트에 맞춤).
 */
export const INITIAL_PRODUCT_CATALOG = [
  { id: 'PRD-01', name: 'HPG 실린더 6L', taktSec: 7.5, defaultQty: 120 },
  { id: 'PRD-02', name: 'HPG 실린더 10L', taktSec: 9.0, defaultQty: 80 },
  { id: 'PRD-03', name: 'HPG 실린더 20L', taktSec: 12.5, defaultQty: 60 },
  { id: 'PRD-04', name: 'HPG 카트리지 리필', taktSec: 6.3, defaultQty: 240 },
];

/** 품목 + 수량 → 로트. id 는 호출부에서 발번해서 넣는다. */
export const makeLot = (id, product, qty, state = 'IDLE') => ({
  id,
  productId: product.id ?? null,
  name: product.name,
  qty,
  taktSec: product.taktSec,
  totalSec: Math.max(1, Math.round(product.taktSec * qty)),
  state,
});

const INITIAL_LOT_SPECS = [
  { productIdx: 0, qty: 120, state: 'RUNNING' },
  { productIdx: 1, qty: 80, state: 'IDLE' },
  { productIdx: 3, qty: 240, state: 'IDLE' },
];

const makeInitialLots = (lineIndex) =>
  INITIAL_LOT_SPECS.map((spec, i) =>
    makeLot(
      makeLotId(lineIndex * 100 + i + 1),
      INITIAL_PRODUCT_CATALOG[spec.productIdx],
      spec.qty,
      spec.state
    )
  );

export const INITIAL_JOBS_BY_LINE = Object.fromEntries(
  PRODUCTION_LINES.map((line, i) => [line.id, makeInitialLots(i)])
);

/** 설비 배치도 라인별로 따로 관리한다 — 한쪽에서 옮겨도 다른 라인은 그대로다 */
export const INITIAL_OFFSETS_BY_LINE = Object.fromEntries(
  PRODUCTION_LINES.map((line) => [
    line.id,
    Object.fromEntries(FACTORY_ASSETS.map((a) => [a.id, [...a.offset]])),
  ])
);

/* ※ 단계별(개포장/이송/충전/검사) 수량 집계는 두지 않는다 — 이 공정은 1세트
   단위 흐름 공정이라 원자재 1개가 라인 전체를 통과하는 것으로 센다.
   (factoryAssets.js 공정 개요 참조. 단계 분해가 필요해지면 그때 다시 설계) */

export const CCTV_FEEDS = [
  { id: 'CAM-01', label: 'Line_1 · 절단기 상부', src: '/cctv/cam-01.mp4' },
  { id: 'CAM-02', label: 'Line_1 · 컨베이어 정면', src: '/cctv/cam-02.mp4' },
];
