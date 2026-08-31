/**
 * =============================================================================
 *  품질 — 불량 유형 시뮬레이션과 파레토 집계
 * =============================================================================
 *  엔진이 로트 완료 때 산출하는 불량 수(0~2%)를 유형별로 쪼개 실적에 기록하고,
 *  리포트가 그것을 파레토(빈도 내림차순 + 누적 점유율)로 집계한다.
 *
 *  유형·가중치는 HPG 충전 공정의 데모 가정값 — 실제 연동 시 MES 불량 코드로
 *  교체한다. 유형이 기록되기 전의 과거 실적은 '유형 미기록'으로 정직하게
 *  분리한다 (소급 창작 금지).
 * ---------------------------------------------------------------------------
 */

export const DEFECT_TYPES = ['포장 파손', '계량 미달', '이물 혼입', '실링 불량'];
const WEIGHTS = [4, 3, 2, 1]; // 발생 경향 — 파레토가 '소수 유형에 집중'되게
const WEIGHT_SUM = WEIGHTS.reduce((a, b) => a + b, 0);

/** 불량 total 건을 가중 추첨으로 유형별 수량에 배분한다 → { 유형: 수량 } */
export const splitDefects = (total, rng = Math.random) => {
  const out = {};
  for (let i = 0; i < Math.max(0, Math.floor(total)); i++) {
    let r = rng() * WEIGHT_SUM;
    let idx = 0;
    while (idx < WEIGHTS.length - 1 && r >= WEIGHTS[idx]) {
      r -= WEIGHTS[idx];
      idx += 1;
    }
    const t = DEFECT_TYPES[idx];
    out[t] = (out[t] ?? 0) + 1;
  }
  return out;
};

/**
 * 불량률 관리도(p-차트 근사) — "언제부터 이상해졌나"에 답한다.
 *  최근 로트들을 시간순으로 놓고 로트별 불량률, 전체 평균(p̄),
 *  관리상한 UCL = p̄ + 3√(p̄(1-p̄)/n̄) (n̄ = 평균 로트 크기)을 돌려준다.
 *  로트 크기가 제각각이라 정식 p-차트의 가변 한계 대신 평균 크기 근사를 쓴다
 *  — 데모 수준의 정직한 단순화이며, 화면에 근사임을 표기한다.
 */
export const defectRateSeries = (production, maxLots = 30) => {
  const lots = (production ?? [])
    .filter((p) => p.qty > 0)
    .slice(0, maxLots)
    .reverse(); // 저장은 최신순 → 차트는 시간순
  if (lots.length === 0) return { rows: [], mean: 0, ucl: 0, nbar: 0 };
  const totalQty = lots.reduce((s, p) => s + p.qty, 0);
  const totalDef = lots.reduce((s, p) => s + (p.defects ?? 0), 0);
  const mean = totalDef / totalQty;
  const nbar = totalQty / lots.length;
  const ucl = mean === 0 ? 0 : mean + 3 * Math.sqrt((mean * (1 - mean)) / nbar);
  return {
    rows: lots.map((p) => ({
      id: p.jobId ?? p.id,
      lineId: p.lineId,
      at: p.finishedAt,
      qty: p.qty,
      rate: (p.defects ?? 0) / p.qty,
    })),
    mean,
    ucl,
    nbar,
  };
};

/**
 * 생산 실적 → 파레토 행 (빈도 내림차순, share 점유율, cum 누적 점유율).
 *  defectTypes 가 없는 과거 실적의 불량은 '유형 미기록' 한 줄로 모은다.
 */
export const defectPareto = (production) => {
  const agg = new Map();
  let untyped = 0;
  (production ?? []).forEach((p) => {
    if (p.defectTypes) {
      Object.entries(p.defectTypes).forEach(([t, n]) => agg.set(t, (agg.get(t) ?? 0) + n));
    } else {
      untyped += p.defects ?? 0;
    }
  });
  const rows = [...agg.entries()]
    .filter(([, n]) => n > 0)
    .map(([type, count]) => ({ type, count }));
  if (untyped > 0) rows.push({ type: '유형 미기록', count: untyped });
  rows.sort((a, b) => b.count - a.count);
  const total = rows.reduce((s, r) => s + r.count, 0);
  let cum = 0;
  return {
    total,
    rows: rows.map((r) => {
      cum += r.count;
      return { ...r, share: r.count / total, cum: cum / total };
    }),
  };
};
