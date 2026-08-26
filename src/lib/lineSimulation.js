/**
 * =============================================================================
 *  라인 몬테카를로 시뮬레이션 — 단일 산식으로는 못 구하는 것들을 내놓는다
 * =============================================================================
 *  결정식(표준시간 합계)은 암산 가능한 값이다. 이 모듈은 확률 모델을 수천 번
 *  돌려서 그 이상을 뽑는다:
 *   1) 완료 시각의 '분포' — 중앙값·90% 신뢰 상한·히스토그램
 *   2) 병목 개선 민감도 — 병목 설비를 개선하면 얼마나 줄고, 누가 새 병목이 되나
 *   3) 소모품 리스크 — 계획 물량을 완주하기 전에 소진되는 소모품과 그 시점
 *   4) 자재 계획 — 필요 원자재 로드 수, 반출 실린더 수
 *
 *  시간 모델은 엔진·애니메이션과 같은 좌표계를 쓴다:
 *   로드 1회 = 오버헤드(도입+마무리 185f) + EA×76f, 실시간 1EA = 택트.
 * ---------------------------------------------------------------------------
 */
import {
  CYLINDER_CAPACITY,
  REPEAT_PERIOD_F,
  SELECTABLE_ASSETS,
  completedEaAt,
  loadPlanFor,
} from '../data/factoryAssets.js';

/* 로드당 오버헤드(도입 140f + 출발 45f) — 프레임. 반복 수와 무관하게 일정하다 */
const LOAD_OVERHEAD_F = 185;

/**
 * 확률 모델 가정 — 화면에도 그대로 명시한다.
 *  cycleJitter 는 생산 엔진과 동일한 분포(0.96~1.02)라 예측과 실측이 같은
 *  세계를 산다. 돌발 정지는 엔진이 재현하지 않는 '리스크 요인'이므로
 *  결과 문구에 모델 포함 여부를 밝힌다.
 */
export const SIM_ASSUMPTIONS = {
  cycleJitterMin: 0.96,
  cycleJitterSpan: 0.06,
  microStopProbPerEa: 0.005, // EA 당 0.5%
  microStopMinSec: 20,
  microStopSpanSec: 70, // 20~90s
  defectRateMax: 0.02, // 로트당 0~2% (엔진과 동일)
};

/**
 * 소모품 마모 모델 (%/EA) — 데모 가정값.
 *  실제 연동 시 설비 이력에서 회귀한 값으로 교체한다.
 */
export const CONSUMABLE_WEAR_PER_EA = {
  CUTTING_UNIT: 0.15, // 톱날 — 1% 당 약 6.7 EA
  CONVEYOR_UNIT: 0.012,
  CART_UNIT: 0.02,
  LOAD_TRANSFER_ROBOT: 0.008,
  POLY_ROBOT: 0.006,
  POPUP_UNIT: 0.01,
};

/** 반복 구간에서 각 설비가 EA 1개에 쓰는 프레임 — 병목 민감도의 근거 */
export const STAGE_FRAMES = {
  POLY_ROBOT: 76,
  CUTTING_UNIT: 69,
  LOAD_TRANSFER_ROBOT: 55,
};

/* ---------------------------------------------------------------------------
 * 결정식 유틸 (몬테카를로와 무관하게 정확한 값들)
 * ------------------------------------------------------------------------- */

/**
 * 대기열 요약 — 총 수량·로드 수·앞으로의 만충 반출 실린더 수.
 *  실린더는 현재 채움분(carryFill)이 이월되므로, 앞으로의 반출 수는
 *  floor((채움 + 남은 수량) / 용량)이어야 옆의 게이지·3D 연출과 일치한다.
 */
export const planSummary = (lots, { carryFill = 0, headDoneEa = 0 } = {}) => {
  const totalQty = lots.reduce((s, l) => s + l.qty, 0);
  const loads = lots.reduce((s, l) => s + loadPlanFor(l.qty).length, 0);
  const remainingQty = Math.max(0, totalQty - headDoneEa);
  return {
    lots: lots.length,
    totalQty,
    loads,
    cylinders: Math.floor((Math.max(0, carryFill) + remainingQty) / CYLINDER_CAPACITY),
  };
};

/**
 * 대기열에서 k번째 EA 가 충전 완료되는 결정식 시각(실초, 배속 미적용).
 *  completedEaAt 의 역방향 — 소모품 소진 시점 표시용.
 */
export const timeOfEa = (lots, k) => {
  if (!(k > 0)) return 0;
  let remaining = Math.floor(k);
  let sec = 0;
  for (const lot of lots) {
    for (const n of loadPlanFor(lot.qty)) {
      if (remaining <= n) {
        /* 이 로드 안에서 끝난다 — EA g 완료는 로드 시작 후 (140+76g)f */
        return sec + (lot.taktSec * (140 + REPEAT_PERIOD_F * remaining)) / REPEAT_PERIOD_F;
      }
      sec += (lot.taktSec * (LOAD_OVERHEAD_F + REPEAT_PERIOD_F * n)) / REPEAT_PERIOD_F;
      remaining -= n;
    }
  }
  return sec; // k 가 계획 물량을 넘으면 전체 소요를 돌려준다
};

/**
 * 병목 개선 민감도 — 병목 설비의 사이클을 improve 비율만큼 줄이면?
 *  반복 주기는 가장 느린 설비가 정하므로, 개선 후 주기 = 나머지 중 최대.
 *  줄어드는 건 반복 구간뿐이고 로드 오버헤드는 그대로다.
 */
export const bottleneckSensitivity = (lots, improve = 0.1, headElapsedSec = 0) => {
  const entries = Object.entries(STAGE_FRAMES).sort((a, b) => b[1] - a[1]);
  const [bottleneckId, bottleneckF] = entries[0];
  const improvedF = bottleneckF * (1 - improve);
  const newPeriodF = Math.max(improvedF, ...entries.slice(1).map(([, f]) => f));
  const newBottleneckId =
    entries.slice(1).find(([, f]) => f >= improvedF)?.[0] ?? bottleneckId;

  /* 이미 생산된 선두 로트 진행분은 미래 개선의 혜택을 받지 못한다 —
     '지금부터' 남은 수량 기준으로 계산해야 옆의 완료 예측과 좌표가 맞는다 */
  const head = lots[0];
  const headDoneEa = head ? completedEaAt(headElapsedSec, head.qty, head.taktSec) : 0;
  const savedSec = lots.reduce(
    (s, l, i) =>
      s +
      (Math.max(0, l.qty - (i === 0 ? headDoneEa : 0)) *
        l.taktSec *
        (REPEAT_PERIOD_F - newPeriodF)) /
        REPEAT_PERIOD_F,
    0
  );
  return {
    bottleneckId,
    improve,
    newPeriodF,
    newBottleneckId: newBottleneckId === bottleneckId ? null : newBottleneckId,
    savedSec,
    savedPct: (REPEAT_PERIOD_F - newPeriodF) / REPEAT_PERIOD_F, // 반복 구간 기준
  };
};

/**
 * 소모품 전망 — '지금부터' 남은 계획 물량을 완주할 수 있는지, 못 하면 언제 소진되는지.
 *  소모품 percent 는 '현재' 잔량이므로 remainingEa 는 지금부터 처리 가능한 EA 수다.
 *  따라서 비교 대상은 남은 계획(전체 − 선두 완료분)이고, 소진 시각은 큐 시작이 아니라
 *  (완료분 + remainingEa)번째 EA 에서 현재 경과를 뺀 '지금부터 남은 초'로 돌려준다.
 *  위험한 것부터 정렬한다.
 */
export const consumableOutlook = (lots, headElapsedSec = 0) => {
  const head = lots[0];
  const headDoneEa = head ? completedEaAt(headElapsedSec, head.qty, head.taktSec) : 0;
  const neededEa = Math.max(0, lots.reduce((s, l) => s + l.qty, 0) - headDoneEa);
  return SELECTABLE_ASSETS.filter((a) => a.consumable)
    .map((a) => {
      const wear = CONSUMABLE_WEAR_PER_EA[a.id] ?? 0.01;
      const remainingEa = Math.floor(a.consumable.percent / wear);
      const ok = remainingEa >= neededEa;
      return {
        assetId: a.id,
        name: a.nameKo,
        label: a.consumable.label,
        percent: a.consumable.percent,
        remainingEa,
        neededEa,
        ok,
        runOutSec: ok
          ? null
          : Math.max(0, timeOfEa(lots, headDoneEa + remainingEa) - headElapsedSec), // 지금부터 남은 실초
      };
    })
    .sort((a, b) => a.remainingEa - b.remainingEa);
};

/* ---------------------------------------------------------------------------
 * 몬테카를로
 * ------------------------------------------------------------------------- */

/** 로트 1개의 소요(실초)를 확률적으로 1회 샘플링 */
export const sampleLotSec = (lot, rng) => {
  const A = SIM_ASSUMPTIONS;
  let sec = 0;
  for (const n of loadPlanFor(lot.qty)) {
    sec += (lot.taktSec * LOAD_OVERHEAD_F) / REPEAT_PERIOD_F; // 도입+마무리
    for (let i = 0; i < n; i++) {
      sec += lot.taktSec * (A.cycleJitterMin + rng() * A.cycleJitterSpan);
      if (rng() < A.microStopProbPerEa) {
        sec += A.microStopMinSec + rng() * A.microStopSpanSec;
      }
    }
  }
  return sec;
};

const quantile = (sorted, q) => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
};

/**
 * 대기열 전체를 runs 회 시뮬레이션한다.
 *  - headElapsedSec: 선두 로트의 이미 진행된 시간 — 남은 부분만 샘플링 비율로 차감
 *  - speed: 현재 배속 — 결과의 벽시계 환산에만 쓴다
 *  - 청크로 나눠 돌며 onProgress(done, total) 로 '실제 진행'을 보고한다
 *  - isCancelled() 가 true 를 돌려주면 즉시 중단한다
 */
export function simulateLine({
  lots,
  headElapsedSec = 0,
  carryFill = 0,
  speed = 1,
  runs = 2000,
  rng = Math.random,
  chunkSize = 250,
  onProgress,
  isCancelled = () => false,
}) {
  const t0 = performance.now();
  const A = SIM_ASSUMPTIONS;
  const totals = [];
  const defectsPerRun = [];
  const head = lots[0] ?? null;
  const headDoneEa = head ? completedEaAt(headElapsedSec, head.qty, head.taktSec) : 0;
  const headRemainEa = head ? Math.max(0, head.qty - headDoneEa) : 0;
  const headDetRemainSec = head ? Math.max(0, head.totalSec - headElapsedSec) : 0;

  return new Promise((resolve) => {
    let done = 0;
    const step = () => {
      if (isCancelled()) return resolve(null);
      const end = Math.min(runs, done + chunkSize);
      for (; done < end; done++) {
        let sec = 0;
        let defects = 0;
        lots.forEach((lot, i) => {
          let lotSec;
          if (i === 0 && headElapsedSec > 0) {
            /* 선두 로트는 '남은 EA'에만 확률 편차를 얹는다.
               전체를 샘플링해 (1-진행률)을 곱하면 남은 구간의 분산과
               돌발 정지 꼬리가 진행률만큼 눌려 P90 이 낙관적으로 나온다. */
            lotSec = headDetRemainSec;
            for (let j = 0; j < headRemainEa; j++) {
              /* 지터는 결정적 기준선 위에 (배율−1) 편차로 얹는다 (평균 −0.01) */
              lotSec += lot.taktSec * (A.cycleJitterMin - 1 + rng() * A.cycleJitterSpan);
              if (rng() < A.microStopProbPerEa) {
                lotSec += A.microStopMinSec + rng() * A.microStopSpanSec;
              }
            }
            lotSec = Math.max(0, lotSec);
          } else {
            lotSec = sampleLotSec(lot, rng);
          }
          sec += lotSec;
          defects += Math.round(lot.qty * rng() * A.defectRateMax);
        });
        totals.push(sec);
        defectsPerRun.push(defects);
      }
      onProgress?.(done, runs);
      if (done < runs) {
        setTimeout(step, 0); // UI 를 막지 않게 양보
        return;
      }

      totals.sort((a, b) => a - b);
      const wall = (s) => s / Math.max(0.01, speed);
      /* 히스토그램 — 18개 구간 */
      const BINS = 18;
      const min = totals[0];
      const max = totals[totals.length - 1];
      const span = Math.max(1e-9, max - min);
      const bins = Array.from({ length: BINS }, () => 0);
      totals.forEach((s) => {
        bins[Math.min(BINS - 1, Math.floor(((s - min) / span) * BINS))] += 1;
      });

      resolve({
        runs,
        tookMs: Math.max(1, Math.round(performance.now() - t0)),
        summary: planSummary(lots, { carryFill, headDoneEa }),
        finishWallSec: {
          p50: wall(quantile(totals, 0.5)),
          p90: wall(quantile(totals, 0.9)),
          min: wall(min),
          max: wall(max),
        },
        histogram: { bins, minSec: wall(min), maxSec: wall(max) },
        defects: {
          mean: Math.round(defectsPerRun.reduce((s, d) => s + d, 0) / runs),
          max: Math.max(...defectsPerRun),
        },
        sensitivity: bottleneckSensitivity(lots, 0.1, headElapsedSec),
        consumables: consumableOutlook(lots, headElapsedSec),
        speed,
      });
    };
    step();
  });
}
