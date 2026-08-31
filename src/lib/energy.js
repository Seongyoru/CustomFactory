/**
 * =============================================================================
 *  에너지 모니터링 (모의) — 텔레메트리 전류에서 소비 전력을 유도한다
 * =============================================================================
 *  실계측 전력계가 없으므로 3상 전력 근사식으로 유도한다 (데모 가정 명시):
 *   P(kW) = Σ전류(A) × 380V × √3 × 역률 0.85 / 1000
 *  실연동 시 전력계 태그로 교체하면 된다 — 화면은 kW/kWh 값만 본다.
 */

export const VOLTAGE_V = 380;
export const POWER_FACTOR = 0.85;
/** kWh → CO₂ 환산계수(kg) — 국내 전력 배출계수 근사, 데모 가정 */
export const CO2_KG_PER_KWH = 0.4594;

const SQRT3 = Math.sqrt(3);

/** 라인의 순간 소비 전력(kW) — latest[lineId] (설비별 {temp,vib,amp}) 에서 */
export const linePowerKw = (assetsLatest) => {
  const ampSum = Object.values(assetsLatest ?? {}).reduce(
    (s, m) => s + (Number.isFinite(m?.amp) ? m.amp : 0),
    0
  );
  return (ampSum * VOLTAGE_V * SQRT3 * POWER_FACTOR) / 1000;
};

/**
 * kWh 적분 한 걸음 — kW 를 dt(ms)만큼 누적한다.
 *  탭 정지 후 복귀 등으로 dt 가 비정상적으로 크면 maxDtMs 로 '클램프'한다 —
 *  버리면(드롭) 발행 주기가 maxDtMs 보다 느린 게이트웨이에서 적산이 조용히 0에
 *  머물고, 그대로 적산하면 멈춰 있던 시간이 마지막 전력으로 소급 부풀려진다.
 *  클램프는 둘 다 막는다: 느린 소스도 걸음마다 적산되고, 장시간 공백은 최대
 *  maxDtMs 어치(무시할 수준)만 더해진다. 상한 30초는 지원할 발행 주기의 여유값.
 */
export const integrateKwh = (kw, dtMs, maxDtMs = 30_000) => {
  if (!(kw >= 0) || !(dtMs > 0)) return 0;
  return (kw * Math.min(dtMs, maxDtMs)) / 3_600_000;
};
