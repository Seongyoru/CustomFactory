/**
 * 라인 몬테카를로 시뮬레이션 계약 검사.
 *  확률 모델이라도 계약은 결정적이어야 한다 — 시드 고정 rng 로 재현 가능하게 검사한다.
 */
import { describe, expect, it } from 'vitest';
import { CYLINDER_CAPACITY, REPEAT_PERIOD_F, lotTotalSec } from '../data/factoryAssets.js';
import {
  SIM_ASSUMPTIONS,
  STAGE_FRAMES,
  bottleneckSensitivity,
  consumableOutlook,
  orderSuggestion,
  planSummary,
  probabilityBefore,
  sampleLotSec,
  simulateLine,
  timeOfEa,
} from './lineSimulation.js';

/* 시드 고정 rng (mulberry32) — 테스트 재현성 */
const seeded = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const LOT = (qty, takt = 7.6) => ({ qty, taktSec: takt, totalSec: lotTotalSec(qty, takt) });

describe('결정식 유틸', () => {
  it('planSummary — 수량·로드·실린더 집계', () => {
    const s = planSummary([LOT(20), LOT(50)]);
    expect(s.totalQty).toBe(70);
    expect(s.loads).toBe(1 + 3); // 20 → 1로드, 50 → 20+20+10
    expect(s.cylinders).toBe(Math.floor(70 / CYLINDER_CAPACITY));
  });

  it('timeOfEa — k번째 EA 완료 시각은 단조 증가하고 전체 소요와 이어진다', () => {
    const lots = [LOT(5), LOT(3)];
    let prev = 0;
    for (let k = 1; k <= 8; k++) {
      const t = timeOfEa(lots, k);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
    /* 마지막 EA 완료는 전체 표준시간보다 약간 이르다(마무리 45f 이전) */
    const total = lots.reduce((s, l) => s + l.totalSec, 0);
    expect(timeOfEa(lots, 8)).toBeLessThan(total);
    expect(timeOfEa(lots, 8)).toBeGreaterThan(total - (7.6 * 50) / REPEAT_PERIOD_F - 2);
  });

  it('병목 민감도 — 폴리 10% 개선 시 절단기(69f)가 새 병목이 된다', () => {
    const s = bottleneckSensitivity([LOT(100)], 0.1);
    expect(s.bottleneckId).toBe('POLY_ROBOT');
    expect(s.newPeriodF).toBe(STAGE_FRAMES.CUTTING_UNIT); // 76×0.9=68.4 < 69
    expect(s.newBottleneckId).toBe('CUTTING_UNIT');
    /* 절약 = qty × takt × (76-69)/76 */
    expect(s.savedSec).toBeCloseTo((100 * 7.6 * 7) / 76, 5);
  });

  it('병목 민감도 — 크게 개선하면 그 다음 설비가 한계를 정한다', () => {
    const s = bottleneckSensitivity([LOT(10)], 0.5); // 76→38 이지만 절단기 69 가 막는다
    expect(s.newPeriodF).toBe(69);
  });

  it('소모품 전망 — 톱날(10%)은 대량 계획을 완주하지 못한다', () => {
    const list = consumableOutlook([LOT(440)]);
    const blade = list.find((c) => c.assetId === 'CUTTING_UNIT');
    expect(blade.ok).toBe(false);
    expect(blade.remainingEa).toBeLessThan(440);
    expect(blade.runOutSec).toBeGreaterThan(0);
    /* 가장 위험한 것이 맨 앞 */
    expect(list[0].remainingEa).toBeLessThanOrEqual(list[1].remainingEa);
  });

  it('소모품 전망 — 소량 계획은 전부 완주 가능', () => {
    const list = consumableOutlook([LOT(5)]);
    expect(list.every((c) => c.ok)).toBe(true);
    expect(list.every((c) => c.runOutSec === null)).toBe(true);
  });

  /* --- 적대적 리뷰(2026-08-25)에서 확인된 결함들의 회귀 고정 --- */

  it('[리뷰수정] 소모품 — 진행분을 반영해 잔여 계획과 비교하고, runOutSec 는 지금부터 남은 초다', () => {
    const lots = [LOT(100)];
    const blade = (list) => list.find((c) => c.assetId === 'CUTTING_UNIT'); // 잔량 66 EA
    /* 시작 시점: 100 EA 필요 > 66 → 경고 */
    expect(blade(consumableOutlook(lots, 0)).ok).toBe(false);
    /* 50 EA 진행 시점: 잔여 50 EA ≤ 66 → 완주 가능 (기존엔 거짓 경보) */
    const halfway = timeOfEa(lots, 50);
    const midBlade = blade(consumableOutlook(lots, halfway));
    expect(midBlade.neededEa).toBe(50);
    expect(midBlade.ok).toBe(true);
    /* 대량 계획에서 진행이 늘수록 소진까지 남은 시간은 유지/증가 방향 — 음수·즉시교체 왜곡 없음 */
    const big = [LOT(440)];
    const early = blade(consumableOutlook(big, timeOfEa(big, 10)));
    const later = blade(consumableOutlook(big, timeOfEa(big, 100)));
    expect(early.runOutSec).toBeGreaterThan(0);
    expect(later.runOutSec).toBeGreaterThan(0);
    /* 지금부터 66 EA 어치보다 짧을 수 없다 */
    expect(later.runOutSec).toBeGreaterThan(66 * 7.6 * 0.9);
  });

  it('[리뷰수정] 병목 민감도 — 진행분을 빼고 남은 수량 기준으로 절감을 계산한다', () => {
    const lots = [LOT(100)];
    const at80 = bottleneckSensitivity(lots, 0.1, timeOfEa(lots, 80));
    expect(at80.savedSec).toBeCloseTo((20 * 7.6 * 7) / 76, 5); // 남은 20 EA 기준
    const fresh = bottleneckSensitivity(lots, 0.1, 0);
    expect(fresh.savedSec).toBeCloseTo((100 * 7.6 * 7) / 76, 5);
  });

  it('[리뷰수정] 반출 실린더 — 이월 채움분이 반영된다', () => {
    expect(planSummary([LOT(10)]).cylinders).toBe(2); // 10/4
    expect(planSummary([LOT(10)], { carryFill: 2 }).cylinders).toBe(3); // (2+10)/4
    expect(planSummary([LOT(10)], { carryFill: 2, headDoneEa: 4 }).cylinders).toBe(2); // (2+6)/4
  });

  it('납기 달성 확률 — 정렬 분포의 이분 탐색', () => {
    const dist = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(probabilityBefore(dist, 5)).toBe(0);
    expect(probabilityBefore(dist, 55)).toBe(0.5);
    expect(probabilityBefore(dist, 100)).toBe(1);
    expect(probabilityBefore(dist, 1000)).toBe(1);
    expect(probabilityBefore([], 10)).toBe(0);
  });

  it('순서 최적화(SPT) — 선두는 고정, 대기 로트를 짧은 순으로', () => {
    const lots = [
      { id: 'A', qty: 1, taktSec: 7.6, totalSec: 500 }, // 진행 중 — 고정
      { id: 'B', qty: 1, taktSec: 7.6, totalSec: 300 },
      { id: 'C', qty: 1, taktSec: 7.6, totalSec: 100 },
      { id: 'D', qty: 1, taktSec: 7.6, totalSec: 200 },
    ];
    const s = orderSuggestion(lots);
    expect(s.improvable).toBe(true);
    expect(s.order).toEqual(['A', 'C', 'D', 'B']);
    /* 현재 평균 완료 (300, 400, 600 → 433.3) vs SPT (100, 300, 600 → 333.3) */
    expect(s.savedAvgSec).toBeCloseTo(100, 5);
  });

  it('순서 최적화 — 이미 최적이거나 대기 로트가 1개면 제안하지 않는다', () => {
    expect(
      orderSuggestion([
        { id: 'A', totalSec: 500 },
        { id: 'B', totalSec: 100 },
        { id: 'C', totalSec: 200 },
      ]).improvable
    ).toBe(false);
    expect(orderSuggestion([{ id: 'A', totalSec: 500 }, { id: 'B', totalSec: 100 }]).improvable).toBe(false);
  });

  it('간트 타임라인 — 로트 띠가 이어지고 P90 은 P50 이상이다', async () => {
    const r = await simulateLine({ lots: [LOT(10), LOT(5), LOT(8)], runs: 300, rng: seeded(11) });
    expect(r.timeline.length).toBe(3);
    r.timeline.forEach((row, i) => {
      expect(row.endWallSec).toBeGreaterThan(row.startWallSec);
      expect(row.endP90WallSec).toBeGreaterThanOrEqual(row.endWallSec);
      if (i > 0) expect(row.startWallSec).toBeCloseTo(r.timeline[i - 1].endWallSec, 9);
    });
    /* 마지막 로트의 P50 종료 = 전체 P50 부근 */
    expect(r.timeline[2].endWallSec).toBeCloseTo(r.finishWallSec.p50, 0);
    /* 납기 분포는 정렬돼 있고 총 런 수와 같다 */
    expect(r.totalsWallSorted.length).toBe(300);
    expect(probabilityBefore(r.totalsWallSorted, r.finishWallSec.p90)).toBeGreaterThan(0.85);
  });
});

describe('몬테카를로', () => {
  it('sampleLotSec — 지터 하한/상한 범위 안에 있다 (돌발 정지 제외 시)', () => {
    const rng = seeded(42);
    const lot = LOT(20);
    const base = (7.6 * (185 + 76 * 20)) / 76;
    for (let i = 0; i < 50; i++) {
      const s = sampleLotSec(lot, rng);
      /* 하한: 전 EA 가 0.96 지터 — 오버헤드는 고정 */
      expect(s).toBeGreaterThanOrEqual(base - 20 * 7.6 * 0.04 - 1e-6);
      /* 상한: 전 EA 1.02 지터 + 돌발 정지 최대 */
      expect(s).toBeLessThan(base + 20 * 7.6 * 0.02 + 20 * 90 + 1);
    }
  });

  it('simulateLine — 분위수 순서·히스토그램 합·실행 횟수', async () => {
    const result = await simulateLine({
      lots: [LOT(20), LOT(10)],
      runs: 400,
      rng: seeded(7),
      chunkSize: 100,
    });
    expect(result.runs).toBe(400);
    expect(result.finishWallSec.min).toBeLessThanOrEqual(result.finishWallSec.p50);
    expect(result.finishWallSec.p50).toBeLessThanOrEqual(result.finishWallSec.p90);
    expect(result.finishWallSec.p90).toBeLessThanOrEqual(result.finishWallSec.max);
    expect(result.histogram.bins.reduce((s, b) => s + b, 0)).toBe(400);
    expect(result.summary.totalQty).toBe(30);
  });

  it('simulateLine — 선두 로트 진행분만큼 줄고, 배속이 벽시계를 나눈다', async () => {
    const lots = [LOT(10)];
    const fresh = await simulateLine({ lots, runs: 200, rng: seeded(1) });
    const half = await simulateLine({
      lots,
      headElapsedSec: lots[0].totalSec / 2,
      runs: 200,
      rng: seeded(1),
    });
    expect(half.finishWallSec.p50).toBeLessThan(fresh.finishWallSec.p50 * 0.65);

    const fast = await simulateLine({ lots, runs: 200, rng: seeded(1), speed: 4 });
    expect(fast.finishWallSec.p50).toBeCloseTo(fresh.finishWallSec.p50 / 4, 4);
  });

  it('[리뷰수정] 선두 로트 진행 중에도 돌발 정지 꼬리가 살아 있다 (분산 붕괴 방지)', async () => {
    /* 90% 진행된 100 EA 로트: 남은 10 EA 의 돌발 정지(+20~90s)가 그대로 반영돼야 한다.
       기존 (1-r) 축소 방식이면 꼬리가 최대 9s 로 눌린다. */
    const lots = [LOT(100)];
    const r90 = timeOfEa(lots, 90);
    const r = await simulateLine({ lots, headElapsedSec: r90, runs: 600, rng: seeded(3) });
    const spread = r.finishWallSec.max - r.finishWallSec.p50;
    expect(spread).toBeGreaterThan(9.5); // 축소 방식의 이론 상한(≈9s)을 넘어야 한다
    /* 중앙값은 결정적 잔여(≈ 남은 표준시간) 부근이어야 한다 */
    const detRemain = lots[0].totalSec - r90;
    expect(r.finishWallSec.p50).toBeGreaterThan(detRemain * 0.9);
    expect(r.finishWallSec.p50).toBeLessThan(detRemain * 1.15);
  });

  it('simulateLine — 취소하면 null 을 돌려준다', async () => {
    const result = await simulateLine({
      lots: [LOT(20)],
      runs: 1000,
      chunkSize: 10,
      isCancelled: () => true,
    });
    expect(result).toBeNull();
  });

  it('평균 완료 시각은 결정식 표준시간보다 약간 길다 (지터 평균 0.99 + 돌발 정지)', async () => {
    const lots = [LOT(50)];
    const det = lots[0].totalSec;
    const r = await simulateLine({ lots, runs: 500, rng: seeded(99) });
    /* 지터 평균 0.99 로 살짝 빨라질 수 있으나 돌발 정지가 얹혀 ±5% 안에 있어야 한다 */
    expect(r.finishWallSec.p50).toBeGreaterThan(det * 0.95);
    expect(r.finishWallSec.p50).toBeLessThan(det * 1.05);
  });
});
