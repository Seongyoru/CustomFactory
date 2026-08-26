/**
 * =============================================================================
 *  설비 보전(정비) — 소모품 라이브 소모·교체·점검 일정의 순수 로직
 * =============================================================================
 *  라인이 EA 를 처리할수록 그 라인 설비의 소모품이 마모율(CONSUMABLE_WEAR_PER_EA,
 *  %/EA)만큼 실제로 줄어든다. 잔량 상태 저장소는 { "라인:설비": percent } 한 장이고,
 *  값이 없으면 라인 설비 마스터(lineAssets)의 초기 잔량이 곧 현재값이다.
 *
 *  임계 2단계:
 *   - WARN(15%) — 표시 상태가 '주의'로 바뀌고 소모품 경고 이벤트를 남긴다
 *   - CRIT(5%)  — 설비 알람(기존 오류 알람 플로우)을 발생시킨다
 *  교체하면 100% 로 리셋되고 교체 이력이 쌓인다 — 점검 이력·리포트가 함께 본다.
 *
 *  React 훅(useMaintenance)이 아니라 여기에 로직을 두는 이유: 마모 적용·임계
 *  판정은 순수 함수라 vitest 로 직접 검증할 수 있다.
 * ---------------------------------------------------------------------------
 */
import { findLineAsset } from '../data/lineAssets.js';
import { CONSUMABLE_WEAR_PER_EA } from './lineSimulation.js';

export const CONSUMABLE_WARN_PCT = 15;
export const CONSUMABLE_CRIT_PCT = 5;

export const consumableKeyOf = (lineId, assetId) => `${lineId}:${assetId}`;

/** 현재 잔량(%) — 저장값이 없으면 라인 인스턴스 마스터의 초기값 */
export const consumablePercentOf = (percents, lineId, assetId) => {
  const stored = percents?.[consumableKeyOf(lineId, assetId)];
  if (typeof stored === 'number') return stored;
  return findLineAsset(lineId, assetId)?.consumable?.percent ?? null;
};

/** 잔량으로 앞으로 처리 가능한 EA 수 (마모율 기준) */
export const remainingEaOf = (percent, assetId) => {
  const wear = CONSUMABLE_WEAR_PER_EA[assetId] ?? 0.01;
  return Math.max(0, Math.floor((percent ?? 0) / wear));
};

/**
 * 한 라인이 deltaEa 개를 처리했을 때의 마모 적용.
 *  percents 는 불변으로 다루고, 실제로 값이 바뀔 때만 새 객체를 돌려준다.
 *  임계 '하향 통과'(초과→이하)만 crossings 로 보고한다 — 이미 임계 아래에서
 *  더 닳는 것은 새 사건이 아니다.
 *  assets: 그 라인의 설비 인스턴스 목록(lineSelectableAssets 결과).
 */
export function applyWear(percents, lineId, deltaEa, assets) {
  if (!(deltaEa > 0)) return { next: percents, crossings: [] };
  let next = percents;
  const crossings = [];
  for (const asset of assets) {
    if (!asset?.consumable) continue;
    const key = consumableKeyOf(lineId, asset.id);
    const cur = consumablePercentOf(percents, lineId, asset.id);
    if (!(cur > 0)) continue; // 이미 0 — 더 깎을 것도, 새로 보고할 것도 없다
    const wear = CONSUMABLE_WEAR_PER_EA[asset.id] ?? 0.01;
    /* 반올림 없이 원값을 유지한다 — 매 적용마다 소수 2자리로 반올림하면 EA 1개
       단위 마모(예: 0.006%)가 0.01%로 올림되는 오차가 체계적으로 누적된다.
       표시는 어차피 화면에서 정수로 반올림한다. */
    const after = Math.max(0, cur - wear * deltaEa);
    if (after === cur) continue;
    if (next === percents) next = { ...percents };
    next[key] = after;
    if (cur > CONSUMABLE_CRIT_PCT && after <= CONSUMABLE_CRIT_PCT) {
      crossings.push({ kind: 'crit', assetId: asset.id, percent: after });
    } else if (cur > CONSUMABLE_WARN_PCT && after <= CONSUMABLE_WARN_PCT) {
      crossings.push({ kind: 'warn', assetId: asset.id, percent: after });
    }
  }
  return { next, crossings };
}

/**
 * 표시용 병합 — 설비 인스턴스에 라이브 잔량을 얹고, 임박 상태면 표시 상태를
 * '주의'로 승격한다 (오류·정지 우선순위는 사이드바가 그 위에서 처리).
 */
export const withLiveConsumable = (asset, percents) => {
  if (!asset?.consumable) return asset;
  const raw = consumablePercentOf(percents, asset.lineId, asset.id);
  const percent = Math.max(0, Math.round(raw ?? asset.consumable.percent));
  const low = percent <= CONSUMABLE_WARN_PCT;
  return {
    ...asset,
    consumable: { ...asset.consumable, percent },
    ...(low && asset.status !== 'ERROR'
      ? { status: 'WARN', statusMessage: `${asset.consumable.label} 교체시기 임박 (${percent}%)` }
      : {}),
  };
};

/** 교체 이력을 설비 점검 이력 형식으로 바꿔 마스터 이력 앞에 끼운다 (최신순 유지) */
export const withMaintHistory = (asset, maintLog) => {
  if (!asset) return asset;
  const mine = (maintLog ?? []).filter(
    (m) => m.lineId === asset.lineId && m.assetId === asset.id
  );
  if (mine.length === 0) return asset;
  const entries = mine.map((m) => ({
    date: m.at.slice(0, 10),
    type: '소모품 교체',
    note: `${m.label} 교체 (잔량 ${Math.round(m.percentBefore)}% → 100%) — ${m.user ?? '-'}`,
  }));
  return { ...asset, history: [...entries, ...(asset.history ?? [])] };
};

/** 차기 점검일까지 남은 일수 — 'YYYY-MM-DD' 기준, 지난 날짜는 음수 */
export const daysUntil = (dateStr, now = new Date()) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? '');
  if (!m) return null;
  const target = new Date(+m[1], +m[2] - 1, +m[3]);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
};

/**
 * 보전 지표 — 이벤트 로그(ALARM_RAISED/ACKED/CLEARED)에서 설비별로 산출한다.
 *  하나의 '고장 건'은 발생(RAISED)으로 열리고 해제(CLEARED)로 닫힌다.
 *  열려 있는 동안의 추가 RAISED 는 코얼레싱 갱신이므로 같은 건으로 본다.
 *   - occurrences: 고장 건수 (열린 건 포함)
 *   - mttaSec: 평균 확인 시간 (발생 → 첫 ACKED)
 *   - mttrSec: 평균 복구 시간 (발생 → CLEARED, 닫힌 건만)
 *   - mtbfSec: 평균 고장 간격 (연속 발생 시각의 간격 평균, 2건 이상일 때)
 *   - openSince: 지금 열려 있는 건의 발생 시각 (없으면 null)
 *  이벤트 로그는 보관 상한이 있으므로(EVENT_LOG_LIMIT) '보관분 기준' 지표다 —
 *  표시할 때 그 사실을 함께 말해야 정직하다.
 */
export const maintenanceKpis = (events) => {
  /* 오래된 것부터 시간순으로 — events 는 최신순 저장이다 */
  const chrono = [...(events ?? [])]
    .filter((e) => e.type?.startsWith('ALARM_') && e.lineId && e.assetId)
    .reverse();
  const byAsset = new Map();
  for (const e of chrono) {
    const key = `${e.lineId}:${e.assetId}`;
    let s = byAsset.get(key);
    if (!s) {
      s = {
        lineId: e.lineId,
        assetId: e.assetId,
        occurrences: 0,
        raisedAts: [],
        ackSecs: [],
        repairSecs: [],
        open: null, // { at, acked }
      };
      byAsset.set(key, s);
    }
    const t = new Date(e.at).getTime();
    if (e.type === 'ALARM_RAISED') {
      if (!s.open) {
        s.open = { at: t, acked: false };
        s.occurrences += 1;
        s.raisedAts.push(t);
      }
      /* 열려 있는 중의 RAISED = 코얼레싱 갱신 — 새 건으로 세지 않는다 */
    } else if (e.type === 'ALARM_ACKED') {
      if (s.open && !s.open.acked) {
        s.open.acked = true;
        s.ackSecs.push((t - s.open.at) / 1000);
      }
    } else if (e.type === 'ALARM_CLEARED') {
      if (s.open) {
        s.repairSecs.push((t - s.open.at) / 1000);
        s.open = null;
      }
    }
  }
  const avg = (xs) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return [...byAsset.values()]
    .map((s) => ({
      lineId: s.lineId,
      assetId: s.assetId,
      occurrences: s.occurrences,
      mttaSec: avg(s.ackSecs),
      mttrSec: avg(s.repairSecs),
      mtbfSec:
        s.raisedAts.length >= 2
          ? (s.raisedAts[s.raisedAts.length - 1] - s.raisedAts[0]) / 1000 / (s.raisedAts.length - 1)
          : null,
      openSince: s.open ? new Date(s.open.at) : null,
    }))
    .sort((a, b) => b.occurrences - a.occurrences);
};

/** 소모품 임계 알람 페이로드 — 기존 오류 알람 플로우(FAULT_SCENARIOS 형태)로 흘린다 */
export const consumableAlarmOf = (asset, percent) => ({
  assetId: asset.id,
  code: `M-${String(asset.id).slice(0, 3)}${CONSUMABLE_CRIT_PCT}0`,
  title: `${asset.consumable.label} 잔량 위험 (${Math.round(percent)}%)`,
  detail:
    `${asset.nameKo}의 ${asset.consumable.label}이(가) 임계치 ${CONSUMABLE_CRIT_PCT}% 이하로 떨어졌습니다. ` +
    `현재 잔량으로는 약 ${remainingEaOf(percent, asset.id)} EA 처리 후 소진됩니다. ` +
    `설비 상세 화면에서 소모품을 교체하면 알람이 해제됩니다.`,
});
