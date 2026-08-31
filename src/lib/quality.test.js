/** 품질 — 불량 유형 배분·파레토 집계 계약 검사 */
import { describe, expect, it } from 'vitest';
import { DEFECT_TYPES, defectPareto, defectRateSeries, splitDefects } from './quality.js';

const seeded = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

describe('quality — splitDefects', () => {
  it('배분 합계는 항상 총 불량 수와 같고, 유형은 정의된 것만 나온다', () => {
    const rng = seeded(7);
    for (const total of [0, 1, 5, 40]) {
      const split = splitDefects(total, rng);
      expect(Object.values(split).reduce((a, b) => a + b, 0)).toBe(total);
      Object.keys(split).forEach((t) => expect(DEFECT_TYPES).toContain(t));
    }
  });

  it('가중치 경향 — 대량 표본에서 첫 유형(가중 4)이 마지막(가중 1)보다 많다', () => {
    const split = splitDefects(2000, seeded(42));
    expect(split[DEFECT_TYPES[0]]).toBeGreaterThan(split[DEFECT_TYPES[3]]);
  });
});

describe('quality — defectPareto', () => {
  it('빈도 내림차순 정렬, 점유율 합 1, 누적은 단조 증가해 1로 끝난다', () => {
    const { total, rows } = defectPareto([
      { defects: 3, defectTypes: { '포장 파손': 2, '실링 불량': 1 } },
      { defects: 4, defectTypes: { '계량 미달': 4 } },
    ]);
    expect(total).toBe(7);
    expect(rows[0].type).toBe('계량 미달');
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].count).toBeLessThanOrEqual(rows[i - 1].count);
      expect(rows[i].cum).toBeGreaterThan(rows[i - 1].cum);
    }
    expect(rows[rows.length - 1].cum).toBeCloseTo(1, 10);
  });

  it('유형 기록 이전의 실적은 소급 창작하지 않고 "유형 미기록"으로 모은다', () => {
    const { rows } = defectPareto([
      { defects: 5 }, // 구버전 실적 — defectTypes 없음
      { defects: 1, defectTypes: { '이물 혼입': 1 } },
    ]);
    const untyped = rows.find((r) => r.type === '유형 미기록');
    expect(untyped?.count).toBe(5);
  });

  it('불량 0 이면 빈 파레토', () => {
    const { total, rows } = defectPareto([{ defects: 0, defectTypes: {} }]);
    expect(total).toBe(0);
    expect(rows).toEqual([]);
  });
});

describe('quality — defectRateSeries (p-차트 근사)', () => {
  const lot = (defects, qty = 100) => ({ id: `P${defects}`, qty, defects, finishedAt: 'x' });

  it('시간순 정렬(저장은 최신순), 평균·UCL 산출', () => {
    const production = [lot(4), lot(2), lot(0)]; // 최신 → 오래된
    const { rows, mean, ucl, nbar } = defectRateSeries(production);
    expect(rows.map((r) => r.rate)).toEqual([0, 0.02, 0.04]); // 오래된 것부터
    expect(mean).toBeCloseTo(6 / 300, 10);
    expect(nbar).toBe(100);
    expect(ucl).toBeCloseTo(mean + 3 * Math.sqrt((mean * (1 - mean)) / 100), 10);
    expect(ucl).toBeGreaterThan(mean);
  });

  it('불량 전무면 UCL 0 (관리도 무의미), 빈 실적이면 빈 시리즈', () => {
    expect(defectRateSeries([lot(0), lot(0)]).ucl).toBe(0);
    expect(defectRateSeries([]).rows).toEqual([]);
  });

  it('maxLots 만큼만 최근 로트를 본다', () => {
    const many = Array.from({ length: 50 }, (_, i) => lot(i % 3));
    expect(defectRateSeries(many, 30).rows).toHaveLength(30);
  });

  it('수량 0 로트(방어)는 제외한다', () => {
    const { rows } = defectRateSeries([lot(1), { id: 'Z', qty: 0, defects: 0 }]);
    expect(rows).toHaveLength(1);
  });
});
