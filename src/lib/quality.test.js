/** 품질 — 불량 유형 배분·파레토 집계 계약 검사 */
import { describe, expect, it } from 'vitest';
import { DEFECT_TYPES, defectPareto, splitDefects } from './quality.js';

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
