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
import { TELEMETRY_BASELINES } from '../telemetry/simulatedSource.js';
import { CO2_KG_PER_KWH, linePowerKw } from './energy.js';

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

/**
 * 인력 배치 가정 (교대당, 데모 가정) — 자동화 라인이라 상주는 소수.
 *  operator 라인 운전·이상 대응 / material 원자재 투입(컨베이어 로드) /
 *  quality 품질 확인(간헐 상주 0.5 = 두 라인 공유).
 *  실공장 적용 시 표준 작업표의 공수로 교체한다.
 */
export const MANNING_ASSUMPTIONS = { operator: 1, material: 1, quality: 0.5 };

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
 *  assets — 라인별 설비 인스턴스(소모품 잔량이 호기마다 다르다). 생략 시 형식 마스터.
 */
export const consumableOutlook = (lots, headElapsedSec = 0, assets = SELECTABLE_ASSETS) => {
  const head = lots[0];
  const headDoneEa = head ? completedEaAt(headElapsedSec, head.qty, head.taktSec) : 0;
  const neededEa = Math.max(0, lots.reduce((s, l) => s + l.qty, 0) - headDoneEa);
  return assets.filter((a) => a.consumable)
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

/**
 * 로트 1개의 소요(실초)를 확률적으로 1회 샘플링 — 시간 구성까지 분해해 돌려준다.
 *  netSec      정미 생산 (수량 × 택트, 결정적)
 *  overheadSec 로드 도입·마무리 (결정적)
 *  jitterSec   사이클 편차의 순기여 (평균 약 −1% — 음수일 수 있다)
 *  stopSec/stopCount  돌발 정지 손실
 *  "시간이 어디로 새는가"의 근거가 된다 — sec = net + overhead + jitter + stop.
 */
export const sampleLotBreakdown = (lot, rng) => {
  const A = SIM_ASSUMPTIONS;
  let netSec = 0;
  let overheadSec = 0;
  let jitterSec = 0;
  let stopSec = 0;
  let stopCount = 0;
  for (const n of loadPlanFor(lot.qty)) {
    overheadSec += (lot.taktSec * LOAD_OVERHEAD_F) / REPEAT_PERIOD_F; // 도입+마무리
    for (let i = 0; i < n; i++) {
      netSec += lot.taktSec;
      jitterSec += lot.taktSec * (A.cycleJitterMin - 1 + rng() * A.cycleJitterSpan);
      if (rng() < A.microStopProbPerEa) {
        stopCount += 1;
        stopSec += A.microStopMinSec + rng() * A.microStopSpanSec;
      }
    }
  }
  return { sec: netSec + overheadSec + jitterSec + stopSec, netSec, overheadSec, jitterSec, stopSec, stopCount };
};

/** 로트 1개의 소요(실초)만 필요할 때 — 분해판의 합계 (기존 계약 유지) */
export const sampleLotSec = (lot, rng) => sampleLotBreakdown(lot, rng).sec;

const quantile = (sorted, q) => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
};

/**
 * 목표 시각(지금부터 targetWallSec 초) 안에 끝날 확률 — 정렬된 분포에서 이분 탐색.
 *  분포 밖이면 0 또는 1 로 수렴한다.
 */
export const probabilityBefore = (sortedWallSec, targetWallSec) => {
  const n = sortedWallSec.length;
  if (n === 0) return 0;
  let lo = 0;
  let hi = n; // [lo, hi) — target 이하인 원소 수를 찾는다
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedWallSec[mid] <= targetWallSec) lo = mid + 1;
    else hi = mid;
  }
  return lo / n;
};

/**
 * 로트 순서 최적화 제안 — SPT(짧은 로트 우선).
 *  단일 라인 직렬 생산이라 총 소요(makespan)는 순서와 무관하지만,
 *  '각 로트가 언제 끝나는가'(평균 완료 시각)는 짧은 로트를 앞세울수록 줄어든다.
 *  진행 중인 선두 로트는 그대로 두고 대기 로트만 정렬 대상으로 삼는다.
 */
export const orderSuggestion = (lots) => {
  const tail = lots.slice(1);
  if (tail.length < 2) {
    return { improvable: false, savedAvgSec: 0, order: lots.map((l) => l.id) };
  }
  const avgCompletion = (list) => {
    let cum = 0;
    let sum = 0;
    list.forEach((l) => {
      cum += l.totalSec;
      sum += cum;
    });
    return sum / list.length;
  };
  const sorted = [...tail].sort((a, b) => a.totalSec - b.totalSec);
  const savedAvgSec = avgCompletion(tail) - avgCompletion(sorted);
  const alreadyOptimal = tail.every((l, i) => l.id === sorted[i].id);
  return {
    improvable: !alreadyOptimal && savedAvgSec > 1,
    savedAvgSec,
    order: [lots[0]?.id, ...sorted.map((l) => l.id)].filter(Boolean),
  };
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
  assets = SELECTABLE_ASSETS, // 라인별 설비 인스턴스 — 소모품 리스크가 호기 잔량을 본다
}) {
  const t0 = performance.now();
  const A = SIM_ASSUMPTIONS;
  const totals = [];
  const defectsPerRun = [];
  const stopSecPerRun = [];
  const stopCountPerRun = [];
  const jitterSecPerRun = [];
  const perLotFinishes = lots.map(() => []); // 간트용 — 로트별 누적 완료 시각 분포
  const head = lots[0] ?? null;
  const headDoneEa = head ? completedEaAt(headElapsedSec, head.qty, head.taktSec) : 0;
  const headRemainEa = head ? Math.max(0, head.qty - headDoneEa) : 0;
  const headDetRemainSec = head ? Math.max(0, head.totalSec - headElapsedSec) : 0;

  /* 시간 구성의 결정적 부분 — 매 회 동일하므로 한 번만 계산한다.
     선두 진행 중 로트의 잔여는 정미(잔여 EA×택트)와 그 밖(도입·마무리 잔여)으로 나눈다. */
  let detNetSec = 0;
  let detOverheadSec = 0;
  lots.forEach((lot, i) => {
    if (i === 0 && headElapsedSec > 0) {
      const net = headRemainEa * lot.taktSec;
      detNetSec += Math.min(net, headDetRemainSec);
      detOverheadSec += Math.max(0, headDetRemainSec - net);
    } else {
      const net = lot.qty * lot.taktSec;
      const overhead = loadPlanFor(lot.qty).length * ((lot.taktSec * LOAD_OVERHEAD_F) / REPEAT_PERIOD_F);
      detNetSec += net;
      detOverheadSec += overhead;
    }
  });

  return new Promise((resolve) => {
    let done = 0;
    const step = () => {
      if (isCancelled()) return resolve(null);
      const end = Math.min(runs, done + chunkSize);
      for (; done < end; done++) {
        let sec = 0;
        let defects = 0;
        let runStopSec = 0;
        let runStopCount = 0;
        let runJitterSec = 0;
        lots.forEach((lot, i) => {
          let lotSec;
          if (i === 0 && headElapsedSec > 0) {
            /* 선두 로트는 '남은 EA'에만 확률 편차를 얹는다.
               전체를 샘플링해 (1-진행률)을 곱하면 남은 구간의 분산과
               돌발 정지 꼬리가 진행률만큼 눌려 P90 이 낙관적으로 나온다. */
            lotSec = headDetRemainSec;
            for (let j = 0; j < headRemainEa; j++) {
              /* 지터는 결정적 기준선 위에 (배율−1) 편차로 얹는다 (평균 −0.01) */
              const jit = lot.taktSec * (A.cycleJitterMin - 1 + rng() * A.cycleJitterSpan);
              lotSec += jit;
              runJitterSec += jit;
              if (rng() < A.microStopProbPerEa) {
                const stop = A.microStopMinSec + rng() * A.microStopSpanSec;
                lotSec += stop;
                runStopSec += stop;
                runStopCount += 1;
              }
            }
            lotSec = Math.max(0, lotSec);
          } else {
            const b = sampleLotBreakdown(lot, rng);
            lotSec = b.sec;
            runJitterSec += b.jitterSec;
            runStopSec += b.stopSec;
            runStopCount += b.stopCount;
          }
          sec += lotSec;
          perLotFinishes[i].push(sec); // 이 로트가 끝나는 누적 시각
          defects += Math.round(lot.qty * rng() * A.defectRateMax);
        });
        totals.push(sec);
        defectsPerRun.push(defects);
        stopSecPerRun.push(runStopSec);
        stopCountPerRun.push(runStopCount);
        jitterSecPerRun.push(runJitterSec);
      }
      onProgress?.(done, runs);
      if (done < runs) {
        setTimeout(step, 0); // UI 를 막지 않게 양보
        return;
      }

      totals.sort((a, b) => a - b);
      const wall = (s) => s / Math.max(0.01, speed);

      /* 로트별 간트 띠 — P50 시작~종료 + P90 종료(리스크 수염) */
      let prevEnd = 0;
      const timeline = lots.map((lot, i) => {
        const sorted = perLotFinishes[i].sort((a, b) => a - b);
        const end = wall(quantile(sorted, 0.5));
        const endP90 = wall(quantile(sorted, 0.9));
        const row = {
          id: lot.id ?? `#${i + 1}`,
          name: lot.name ?? '',
          qty: lot.qty,
          startWallSec: prevEnd,
          endWallSec: end,
          endP90WallSec: endP90,
        };
        prevEnd = end;
        return row;
      });
      /* 히스토그램 — 18개 구간 */
      const BINS = 18;
      const min = totals[0];
      const max = totals[totals.length - 1];
      const span = Math.max(1e-9, max - min);
      const bins = Array.from({ length: BINS }, () => 0);
      totals.forEach((s) => {
        bins[Math.min(BINS - 1, Math.floor(((s - min) / span) * BINS))] += 1;
      });

      /* 전력·인력 — '계획을 완주하는 데 드는 자원'. 배속은 보는 속도일 뿐이므로
         kWh·공수는 표준시간(배속 미적용 초)으로 적산해야 실공정 값이 된다. */
      const p50StdSec = quantile(totals, 0.5);
      const p90StdSec = quantile(totals, 0.9);
      const nominalKw = linePowerKw(TELEMETRY_BASELINES); // 설비 기준 전류 합의 3상 근사
      const headcount = Object.values(MANNING_ASSUMPTIONS).reduce((s, v) => s + v, 0);
      const summary = planSummary(lots, { carryFill, headDoneEa });
      /* 자재 투입(잔여) — 선두 로트에서 이미 시작된 로드는 뺀다. 같은 카드의 공수·kWh 가
         '남은 계획' 표준초 기준이므로 투입 횟수만 전체 계획이면 좌표계가 어긋난다
         (planSummary 의 cylinders 가 잔여 기준인 것과 같은 이유). */
      let fedLoads = 0;
      if (head && headDoneEa > 0) {
        let cum = 0;
        loadPlanFor(head.qty).forEach((sz) => {
          if (headDoneEa > cum) fedLoads += 1;
          cum += sz;
        });
      }

      resolve({
        runs,
        tookMs: Math.max(1, Math.round(performance.now() - t0)),
        summary,
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
        /**
         * 시간 구성 — "남은 계획의 시간이 어디로 가는가" (표준시간 초 기준).
         *  net/overhead 는 결정적, jitter 평균은 살짝 음수(공칭 −1%)일 수 있다.
         *  stop 은 평균과 90% 상한을 함께 준다 — 손실의 꼬리가 계획을 흔드는 주범이다.
         */
        breakdown: {
          netSec: detNetSec,
          overheadSec: detOverheadSec,
          jitterMeanSec: jitterSecPerRun.reduce((s, v) => s + v, 0) / runs,
          stopMeanSec: stopSecPerRun.reduce((s, v) => s + v, 0) / runs,
          stopP90Sec: quantile([...stopSecPerRun].sort((a, b) => a - b), 0.9),
          stopMeanCount: stopCountPerRun.reduce((s, v) => s + v, 0) / runs,
          stopMaxCount: Math.max(...stopCountPerRun),
        },
        /** 전력 소모 전망 — 정격(kW) × 가동 시간. 실계측 전력계 연동 전의 데모 가정 */
        energy: {
          nominalKw,
          kwhP50: (nominalKw * p50StdSec) / 3600,
          kwhP90: (nominalKw * p90StdSec) / 3600,
          co2P50Kg: ((nominalKw * p50StdSec) / 3600) * CO2_KG_PER_KWH,
          co2P90Kg: ((nominalKw * p90StdSec) / 3600) * CO2_KG_PER_KWH,
        },
        /** 인력 배치 전망 — 교대당 상주 가정 × 가동 시간 = 투입 공수 */
        manning: {
          perShift: { ...MANNING_ASSUMPTIONS },
          headcount,
          manHoursP50: (headcount * p50StdSec) / 3600,
          manHoursP90: (headcount * p90StdSec) / 3600,
          feeds: summary.loads - fedLoads, // 앞으로 필요한 자재 투입(컨베이어 로드) 횟수
        },
        sensitivity: bottleneckSensitivity(lots, 0.1, headElapsedSec),
        consumables: consumableOutlook(lots, headElapsedSec, assets),
        timeline,
        totalsWallSorted: totals.map(wall), // 납기 달성 확률 계산용 (정렬 유지)
        orderSuggestion: orderSuggestion(lots),
        speed,
      });
    };
    step();
  });
}
