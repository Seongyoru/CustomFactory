/** 에너지 유도(모의) 계약 검사 */
import { describe, expect, it } from 'vitest';
import { CO2_KG_PER_KWH, POWER_FACTOR, VOLTAGE_V, integrateKwh, linePowerKw } from './energy.js';

describe('energy — 전력 유도', () => {
  it('3상 근사식: Σamp × 380 × √3 × 0.85 / 1000', () => {
    const latest = { A: { amp: 10 }, B: { amp: 5.5 } };
    const expected = (15.5 * VOLTAGE_V * Math.sqrt(3) * POWER_FACTOR) / 1000;
    expect(linePowerKw(latest)).toBeCloseTo(expected, 10);
  });

  it('숫자가 아닌 전류(죽은 센서)는 0 취급, 빈 라인은 0kW', () => {
    expect(linePowerKw({ A: { amp: NaN }, B: {}, C: null })).toBe(0);
    expect(linePowerKw(undefined)).toBe(0);
  });

  it('kWh 적분 — 10kW 로 1시간이면 10kWh (걸음 단위 합산)', () => {
    let kwh = 0;
    for (let i = 0; i < 3600; i++) kwh += integrateKwh(10, 1000);
    expect(kwh).toBeCloseTo(10, 6);
  });

  it('비정상 dt(탭 정지 복귀 등)는 상한으로 클램프한다 — 소급 부풀림과 0 고착을 둘 다 방지', () => {
    /* 1시간 공백도 최대 30초 어치만 더해진다 (부풀림 방지) */
    expect(integrateKwh(10, 3_600_000)).toBeCloseTo(integrateKwh(10, 30_000), 10);
    /* 느린 게이트웨이(6초 주기)도 걸음마다 온전히 적산된다 (드롭이면 0 고착) */
    expect(integrateKwh(10, 6_000)).toBeCloseTo((10 * 6_000) / 3_600_000, 10);
    expect(integrateKwh(10, 0)).toBe(0);
    expect(integrateKwh(-1, 1000)).toBe(0);
  });

  it('CO₂ 계수는 양수 상수(데모 가정)', () => {
    expect(CO2_KG_PER_KWH).toBeGreaterThan(0);
  });
});
