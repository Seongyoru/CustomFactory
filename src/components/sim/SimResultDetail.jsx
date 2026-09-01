/**
 * =============================================================================
 *  시뮬레이션 결과 상세 — 라이브 팝업과 리포트 스냅샷 상세가 공유하는 표시부
 * =============================================================================
 *  같은 JSX 를 두 곳에서 쓴다:
 *   - 라이브: LeftDashboardPanel 의 결과 모달 (dueSlot/actionSlot 로 상호작용 주입)
 *   - 리포트: 저장된 스냅샷의 detail 페이로드 (읽기 전용, 슬롯 없음)
 *  스냅샷은 totalsWallSorted(2천 개 분포)를 들고 다니지 않으므로, 교대·금일
 *  확률은 저장 시점에 계산된 pShift/pToday 를 그대로 쓴다. 날짜 필드는
 *  Date/ISO 문자열 어느 쪽이 와도 동작한다.
 */
import React from 'react';
import { findAsset } from '../../data/factoryAssets.js';
import { SIM_ASSUMPTIONS, probabilityBefore } from '../../lib/lineSimulation.js';
import { fmtClock, fmtKoDuration, fmtSpeed } from '../../lib/format.js';
import { shiftOf } from '../../lib/shift.js';

/** Date · ISO 문자열 겸용 — 스냅샷 복원 시 문자열로 돌아온다 */
const asDate = (v) => (v instanceof Date ? v : new Date(v));

/**
 * 생산 진행 곡선(S-커브) — "그 시각에 몇 개까지 나와 있을까".
 *  로트 경계의 P50 완료 시각으로 누적 수량 곡선을 그리고, P90 을 점선 밴드로 겹친다.
 *  두 선의 벌어짐이 곧 계획의 불확실성이다.
 */
export const ProgressCurve = ({ theme, timeline, anchorMs }) => {
  const W = 264;
  const H = 96;
  const plotH = 78;
  const totalQty = timeline.reduce((s, r) => s + r.qty, 0);
  const xMax = Math.max(1e-9, timeline[timeline.length - 1].endP90WallSec);
  const xOf = (sec) => (sec / xMax) * (W - 8) + 4;
  const yOf = (qty) => plotH - (qty / Math.max(1, totalQty)) * (plotH - 8);
  let cum = 0;
  const p50Pts = [[xOf(0), yOf(0)]];
  const p90Pts = [[xOf(0), yOf(0)]];
  timeline.forEach((r) => {
    cum += r.qty;
    p50Pts.push([xOf(r.endWallSec), yOf(cum)]);
    p90Pts.push([xOf(r.endP90WallSec), yOf(cum)]);
  });
  const toStr = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="생산 진행 곡선">
      <line x1="4" x2={W - 4} y1={plotH} y2={plotH} stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
      {/* P90 — 늦어질 수 있는 경로 */}
      <polyline points={toStr(p90Pts)} fill="none" stroke={theme.accentHex} strokeWidth="1.1" strokeDasharray="3 3" opacity="0.45" />
      {/* P50 — 기대 경로 */}
      <polyline points={toStr(p50Pts)} fill="none" stroke={theme.accentHex} strokeWidth="1.6" />
      {p50Pts.slice(1).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2" fill={theme.accentHex} />
      ))}
      <text x="4" y={H - 2} fontSize="8" fill="currentColor" opacity="0.45">지금</text>
      <text x={W - 4} y={H - 2} textAnchor="end" fontSize="8" fill="currentColor" opacity="0.45">
        ~{fmtClock(new Date(anchorMs + xMax * 1000), false)}
      </text>
      <text x={W - 4} y="10" textAnchor="end" fontSize="8" fill="currentColor" opacity="0.55">
        {totalQty} EA
      </text>
    </svg>
  );
};

/** 시간 구성 스택바 — 남은 계획의 시간이 어디로 가는가 (표준시간 기준) */
export const TimeBreakdownBar = ({ theme, breakdown }) => {
  const stop = Math.max(0, breakdown.stopMeanSec);
  const total = Math.max(1e-9, breakdown.netSec + breakdown.overheadSec + stop);
  const seg = (v) => `${(v / total) * 100}%`;
  const rows = [
    ['정미 생산', breakdown.netSec, theme.accentHex, 1],
    ['도입·마무리', breakdown.overheadSec, theme.accentHex, 0.35],
    ['돌발 정지(평균)', stop, '#ef4444', 0.85],
  ];
  return (
    <div>
      <div className={`flex h-2 rounded-full overflow-hidden ${theme.trackBg}`}>
        {rows.map(([k, v, color, op]) => (
          <span key={k} style={{ width: seg(v), backgroundColor: color, opacity: op }} title={`${k} ${fmtKoDuration(Math.round(v))}`} />
        ))}
      </div>
      <div className={`mt-1 grid grid-cols-3 gap-1 text-[9px] tabular-nums ${theme.textFaint}`}>
        {rows.map(([k, v]) => (
          <span key={k} className="truncate">{k} {Math.round((v / total) * 100)}%</span>
        ))}
      </div>
    </div>
  );
};

/** 인력 역할 표기 — MANNING_ASSUMPTIONS 키의 한국어 라벨 */
const MANNING_LABELS = { operator: '라인 운전', material: '자재 투입', quality: '품질 확인' };

/**
 * 결과 본문.
 *  r        — simulateLine 결과(라이브) 또는 스냅샷 detail(복원). 필드가 없으면 해당 카드 생략.
 *  dueSlot  — 목표 납기 입력 박스 (라이브 전용, 리포트는 null)
 *  actionSlot — SPT 정렬 제안·스냅샷 저장 등 조작 요소 (라이브 전용)
 */
const SimResultDetail = ({ theme, r, dueSlot = null, actionSlot = null }) => {
  const risky = (r.consumables ?? []).filter((c) => !c.ok);
  const maxBin = Math.max(1, ...r.histogram.bins);
  const sens = r.sensitivity;
  const anchor = new Date(r.anchorMs);

  /* 교대·금일 확률 — 라이브는 분포에서 즉석 계산, 스냅샷은 저장 시점 값 사용 */
  let { pShift, pToday, shiftLabel } = r;
  if (r.totalsWallSorted) {
    const sh = shiftOf(anchor);
    const midnight = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1);
    pShift = probabilityBefore(r.totalsWallSorted, (sh.endAt.getTime() - r.anchorMs) / 1000);
    pToday = probabilityBefore(r.totalsWallSorted, (midnight.getTime() - r.anchorMs) / 1000);
    shiftLabel = sh.label;
  }
  const chip = (label, p) => (
    <span
      className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold tabular-nums
        ${p >= 0.9 ? 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10'
          : p >= 0.5 ? `${theme.chip}`
          : 'text-amber-500 border-amber-500/40 bg-amber-500/10'}`}
    >
      {label} {Math.round(p * 100)}%
    </span>
  );

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-start">
        {/* ── 좌열: 완료 예측·납기·산출·자원 ─────────────────────── */}
        <div className="space-y-2.5">
          {/* 완료 시각 — 중앙값 + 90% 신뢰 상한 */}
          <div className={`rounded-lg border ${theme.panelBorder} ${theme.accentBgSoft} px-3 py-2.5`}>
            <div className="flex items-baseline justify-between">
              <span className={`text-[10px] ${theme.textFaint}`}>완료 예정 (중앙값)</span>
              <span className={`text-[10px] tabular-nums ${theme.textMuted}`}>
                90% 확률 {fmtClock(asDate(r.finishAtP90), false)} 이전
              </span>
            </div>
            <p className={`mt-0.5 text-[22px] font-bold tabular-nums leading-none ${theme.accentText}`}>
              {fmtClock(asDate(r.finishAtP50), false)}
            </p>

            {/* 완료 시간 분포 히스토그램 — 수천 회의 흩어짐 */}
            <div className="mt-2 flex items-end gap-[1px] h-12" aria-label="완료 시간 분포">
              {r.histogram.bins.map((b, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-t-[2px]"
                  style={{
                    height: `${Math.max(4, (b / maxBin) * 100)}%`,
                    backgroundColor: theme.accentHex,
                    opacity: b === 0 ? 0.12 : 0.35 + 0.65 * (b / maxBin),
                  }}
                  title={`${b}회`}
                />
              ))}
            </div>
            <div className={`mt-0.5 flex justify-between text-[9px] tabular-nums ${theme.textGhost}`}>
              <span>{fmtKoDuration(r.histogram.minSec)}</span>
              <span>소요 분포</span>
              <span>{fmtKoDuration(r.histogram.maxSec)}</span>
            </div>

            {/* 교대·금일 연계 확률 — "이 계획, 우리 조에서 끝나나?" */}
            {Number.isFinite(pShift) && Number.isFinite(pToday) && (
              <div className="mt-2 flex items-center gap-1.5">
                {chip(`${shiftLabel} 내 완료`, pShift)}
                {chip('금일 내 완료', pToday)}
              </div>
            )}
          </div>

          {/* 목표 납기 → 달성 확률 (라이브 전용 슬롯) */}
          {dueSlot}

          {/* 산출 요약 */}
          <div className={`grid grid-cols-3 gap-1.5 rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-2 py-2 text-center`}>
            {[
              ['생산', `${r.summary.totalQty} EA`],
              ['예상 불량', `~${r.defects.mean} EA`],
              ['반출 실린더', `${r.summary.cylinders}개`],
            ].map(([k, v]) => (
              <div key={k}>
                <p className={`text-[10px] ${theme.textFaint}`}>{k}</p>
                <p className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.textSecondary}`}>{v}</p>
              </div>
            ))}
          </div>

          {/* 전력 소모 전망 — 정격 kW × 가동 시간 (표준시간 기준, 데모 가정) */}
          {r.energy && (
            <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
              <div className="flex items-baseline justify-between mb-1.5">
                <p className={`text-[10px] font-bold ${theme.textMuted}`}>전력 소모 전망</p>
                <p className={`text-[9px] tabular-nums ${theme.textGhost}`}>
                  정격 {r.energy.nominalKw.toFixed(1)} kW · 3상 근사(데모 가정)
                </p>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                {[
                  ['예상 소모 (P50)', `${r.energy.kwhP50.toFixed(1)}`, 'kWh'],
                  ['90% 상한', `${r.energy.kwhP90.toFixed(1)}`, 'kWh'],
                  ['CO₂ 환산', `${r.energy.co2P50Kg.toFixed(1)}`, 'kg'],
                ].map(([k, v, u]) => (
                  <div key={k}>
                    <p className={`text-[10px] ${theme.textFaint}`}>{k}</p>
                    <p className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.textSecondary}`}>
                      {v} <span className={`text-[9px] ${theme.textFaint}`}>{u}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 인력 배치 전망 — 교대당 상주 가정 × 가동 시간 = 투입 공수 */}
          {r.manning && (
            <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
              <div className="flex items-baseline justify-between mb-1.5">
                <p className={`text-[10px] font-bold ${theme.textMuted}`}>인력 배치 전망</p>
                <p className={`text-[9px] ${theme.textGhost}`}>교대당 상주 가정(데모)</p>
              </div>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {Object.entries(r.manning.perShift).map(([k, v]) => (
                  <span key={k} className={`px-1.5 py-0.5 rounded border text-[9px] tabular-nums ${theme.chip}`}>
                    {MANNING_LABELS[k] ?? k} {v}명
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                {[
                  ['상주 인원', `${r.manning.headcount}`, '명'],
                  ['투입 공수 (P50)', `${r.manning.manHoursP50.toFixed(1)}`, 'm·h'],
                  ['자재 투입', `${r.manning.feeds}`, '회'],
                ].map(([k, v, u]) => (
                  <div key={k}>
                    <p className={`text-[10px] ${theme.textFaint}`}>{k}</p>
                    <p className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.textSecondary}`}>
                      {v} <span className={`text-[9px] ${theme.textFaint}`}>{u}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── 우열: 진행 곡선·시간 구성·타임라인 ──────────────────── */}
        <div className="space-y-2.5">
          {/* 생산 진행 곡선 — 시각별 누적 완성 수량 (P50 실선 · P90 점선) */}
          <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2 ${theme.textSecondary}`}>
            <div className="flex items-baseline justify-between mb-1">
              <p className={`text-[10px] font-bold ${theme.textMuted}`}>생산 진행 곡선</p>
              <p className={`text-[9px] ${theme.textGhost}`}>실선 P50 · 점선 P90 — 벌어질수록 불확실</p>
            </div>
            <ProgressCurve theme={theme} timeline={r.timeline} anchorMs={r.anchorMs} />
          </div>

          {/* 시간 구성 — 남은 계획의 시간이 어디로 가는가 */}
          {r.breakdown && (
            <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
              <div className="flex items-baseline justify-between mb-1.5">
                <p className={`text-[10px] font-bold ${theme.textMuted}`}>시간 구성 (표준시간 기준)</p>
                <p className={`text-[9px] tabular-nums ${theme.textGhost}`}>
                  사이클 편차 평균 {r.breakdown.jitterMeanSec >= 0 ? '+' : '−'}{fmtKoDuration(Math.round(Math.abs(r.breakdown.jitterMeanSec)))}
                </p>
              </div>
              <TimeBreakdownBar theme={theme} breakdown={r.breakdown} />
              <p className={`mt-1.5 text-[10px] leading-relaxed tabular-nums ${theme.textFaint}`}>
                돌발 정지 평균 <b>{r.breakdown.stopMeanCount.toFixed(1)}회 · {fmtKoDuration(Math.round(r.breakdown.stopMeanSec))}</b> 손실
                {r.breakdown.stopP90Sec > r.breakdown.stopMeanSec
                  ? <> — 운 나쁜 날(상위 10%)은 {fmtKoDuration(Math.round(r.breakdown.stopP90Sec))} 이상, 최악 {r.breakdown.stopMaxCount}회까지.</>
                  : <> — 10회 중 9회는 정지 없이 통과하지만, 최악 {r.breakdown.stopMaxCount}회까지 발생했습니다.</>}
              </p>
            </div>
          )}

          {/* 로트별 간트 타임라인 — P50 시작~종료 띠 + P90 리스크 수염 */}
          <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
            <p className={`text-[10px] font-bold mb-1.5 ${theme.textMuted}`}>로트별 타임라인 (P50)</p>
            <div className="space-y-1">
              {r.timeline.map((row) => {
                const span = Math.max(1e-9, r.timeline[r.timeline.length - 1].endP90WallSec);
                const left = (row.startWallSec / span) * 100;
                const width = Math.max(1.5, ((row.endWallSec - row.startWallSec) / span) * 100);
                const whisker = ((row.endP90WallSec - row.endWallSec) / span) * 100;
                return (
                  <div
                    key={row.id}
                    className="flex items-center gap-1.5"
                    title={`${row.name} · ${row.qty} EA · ${fmtClock(new Date(r.anchorMs + row.endWallSec * 1000), false)} 완료 예정 (90%: ${fmtClock(new Date(r.anchorMs + row.endP90WallSec * 1000), false)})`}
                  >
                    <span className={`w-8 shrink-0 text-[9px] tabular-nums truncate ${theme.textFaint}`}>
                      {String(row.id).split('-').pop()}
                    </span>
                    <span className={`relative flex-1 h-2 rounded-sm overflow-hidden ${theme.trackBg}`}>
                      <span
                        className="absolute inset-y-0 rounded-sm"
                        style={{ left: `${left}%`, width: `${width}%`, backgroundColor: theme.accentHex, opacity: 0.85 }}
                      />
                      {/* P90 리스크 수염 — 늦어질 수 있는 범위 */}
                      <span
                        className="absolute inset-y-0"
                        style={{ left: `${left + width}%`, width: `${whisker}%`, backgroundColor: theme.accentHex, opacity: 0.25 }}
                      />
                    </span>
                    <span className={`w-9 shrink-0 text-right text-[9px] tabular-nums ${theme.textSecondary}`}>
                      {fmtClock(new Date(r.anchorMs + row.endWallSec * 1000), false)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 병목 개선 민감도 — what-if */}
          {sens && (
            <p className={`text-[10px] leading-relaxed tabular-nums ${theme.textMuted}`}>
              병목 <b className={theme.textSecondary}>{findAsset(sens.bottleneckId)?.nameKo}</b>{' '}
              {Math.round(sens.improve * 100)}% 개선 시{' '}
              <b className={theme.accentText}>−{fmtKoDuration(sens.savedSec / r.speed)}</b>
              {sens.newBottleneckId && (
                <> · 새 병목: {findAsset(sens.newBottleneckId)?.nameKo}</>
              )}
            </p>
          )}

          {/* 소모품 리스크 */}
          {r.consumables && (risky.length > 0 ? (
            risky.map((c) => (
              <p key={c.assetId} className="text-[10px] leading-relaxed tabular-nums text-red-500">
                ⚠ {findAsset(c.assetId)?.nameKo} {c.label} {c.percent}% — 약 {c.remainingEa} EA 후
                소진 (잔여 계획 {c.neededEa} EA){c.replaceAt ? <>, {fmtClock(asDate(c.replaceAt), false)}경 교체 필요</> : null}
              </p>
            ))
          ) : (
            <p className="text-[10px] leading-relaxed text-emerald-500">
              ✓ 소모품 전 항목 잔여 계획 완주 가능
            </p>
          ))}
        </div>
      </div>

      {/* 조작 요소(SPT 정렬·스냅샷 저장) — 라이브 전용 슬롯 */}
      {actionSlot}

      <p className={`text-[9px] tabular-nums ${theme.textGhost}`}>
        몬테카를로 {r.runs.toLocaleString()}회 · {r.tookMs}ms · 사이클 편차 ±3% ·
        돌발 정지 {SIM_ASSUMPTIONS.microStopProbPerEa * 100}%/EA · ×{fmtSpeed(r.speed)} 배속 기준
      </p>
    </div>
  );
};

export default SimResultDetail;
