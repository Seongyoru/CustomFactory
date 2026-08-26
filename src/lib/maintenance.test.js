/** 설비 보전(소모품 마모·임계·교체 표시) 순수 로직 계약 검사 */
import { describe, expect, it } from 'vitest';
import { findLineAsset, lineSelectableAssets } from '../data/lineAssets.js';
import { CONSUMABLE_WEAR_PER_EA } from './lineSimulation.js';
import {
  CONSUMABLE_CRIT_PCT,
  CONSUMABLE_WARN_PCT,
  applyWear,
  consumableAlarmOf,
  consumablePercentOf,
  daysUntil,
  remainingEaOf,
  withLiveConsumable,
  withMaintHistory,
} from './maintenance.js';

const L1_ASSETS = lineSelectableAssets('L1');
const L2_ASSETS = lineSelectableAssets('L2');

describe('maintenance — 소모품 마모', () => {
  it('잔량 조회 — 저장값이 없으면 라인 인스턴스 마스터의 초기값', () => {
    expect(consumablePercentOf({}, 'L1', 'CUTTING_UNIT')).toBe(10);
    expect(consumablePercentOf({}, 'L2', 'CUTTING_UNIT')).toBe(68);
    expect(consumablePercentOf({ 'L1:CUTTING_UNIT': 42 }, 'L1', 'CUTTING_UNIT')).toBe(42);
  });

  it('applyWear — Δ만큼 마모율대로 깎이고, 라인이 다르면 서로 침범하지 않는다', () => {
    const { next } = applyWear({}, 'L2', 100, L2_ASSETS);
    const wear = CONSUMABLE_WEAR_PER_EA.CUTTING_UNIT; // 0.15 %/EA
    expect(next['L2:CUTTING_UNIT']).toBeCloseTo(68 - wear * 100, 2);
    expect(next['L1:CUTTING_UNIT']).toBeUndefined(); // L1 은 건드리지 않음
    /* Δ=0/음수는 원본 참조 그대로 (불필요한 리렌더 방지) */
    expect(applyWear(next, 'L2', 0, L2_ASSETS).next).toBe(next);
    expect(applyWear(next, 'L2', -5, L2_ASSETS).next).toBe(next);
  });

  it('applyWear — 임계 "하향 통과"만 보고한다 (warn 15% / crit 5%)', () => {
    /* L2 벨트 91% → 대량 처리로 15% 아래로: warn 1회 */
    const start = { 'L2:CONVEYOR_UNIT': 15.5 };
    const one = applyWear(start, 'L2', 50, L2_ASSETS); // 15.5 - 0.012×50 = 14.9
    expect(one.crossings.some((c) => c.assetId === 'CONVEYOR_UNIT' && c.kind === 'warn')).toBe(true);
    /* 이미 15% 아래에서 더 닳는 것은 새 사건이 아니다 */
    const two = applyWear(one.next, 'L2', 50, L2_ASSETS);
    expect(two.crossings.filter((c) => c.assetId === 'CONVEYOR_UNIT')).toEqual([]);
  });

  it('applyWear — L1 톱날(10%)은 이미 warn 아래라 crit 통과만 보고한다', () => {
    const { next, crossings } = applyWear({}, 'L1', 40, L1_ASSETS); // 10 - 0.15×40 = 4
    const blade = crossings.filter((c) => c.assetId === 'CUTTING_UNIT');
    expect(blade).toHaveLength(1);
    expect(blade[0].kind).toBe('crit');
    expect(next['L1:CUTTING_UNIT']).toBeCloseTo(4, 2);
  });

  it('applyWear — 0 아래로 내려가지 않고, 0 이 된 뒤에는 조용하다', () => {
    const { next } = applyWear({}, 'L1', 10_000, L1_ASSETS);
    expect(next['L1:CUTTING_UNIT']).toBe(0);
    const again = applyWear(next, 'L1', 100, L1_ASSETS);
    expect(again.crossings.filter((c) => c.assetId === 'CUTTING_UNIT')).toEqual([]);
  });

  it('remainingEaOf — 잔량 ÷ 마모율의 내림', () => {
    expect(remainingEaOf(10, 'CUTTING_UNIT')).toBe(Math.floor(10 / 0.15)); // 66
    expect(remainingEaOf(0, 'CUTTING_UNIT')).toBe(0);
  });
});

describe('maintenance — 표시 병합', () => {
  it('withLiveConsumable — 라이브 잔량이 얹히고, 15% 이하면 상태가 주의로 승격', () => {
    const base = findLineAsset('L2', 'CUTTING_UNIT'); // RUNNING, 68%
    const ok = withLiveConsumable(base, { 'L2:CUTTING_UNIT': 50 });
    expect(ok.consumable.percent).toBe(50);
    expect(ok.status).toBe('RUNNING');
    const low = withLiveConsumable(base, { 'L2:CUTTING_UNIT': 12.4 });
    expect(low.consumable.percent).toBe(12);
    expect(low.status).toBe('WARN');
    expect(low.statusMessage).toContain('교체시기 임박');
  });

  it('withMaintHistory — 이 호기의 교체 이력만 점검 이력 앞에 끼운다', () => {
    const base = findLineAsset('L1', 'CUTTING_UNIT');
    const log = [
      { lineId: 'L1', assetId: 'CUTTING_UNIT', at: '2026-08-26T10:00:00.000Z', label: '톱날 잔여', percentBefore: 4, user: '운영자' },
      { lineId: 'L2', assetId: 'CUTTING_UNIT', at: '2026-08-26T09:00:00.000Z', label: '톱날 잔여', percentBefore: 30, user: '운영자' },
    ];
    const merged = withMaintHistory(base, log);
    expect(merged.history.length).toBe(base.history.length + 1);
    expect(merged.history[0].type).toBe('소모품 교체');
    expect(merged.history[0].note).toContain('4% → 100%');
    /* 이력이 없으면 원본 참조 그대로 */
    expect(withMaintHistory(base, [])).toBe(base);
  });

  it('daysUntil — 오늘 0, 미래 양수, 과거 음수, 형식 불량 null', () => {
    const now = new Date(2026, 7, 26); // 2026-08-26
    expect(daysUntil('2026-08-26', now)).toBe(0);
    expect(daysUntil('2026-09-02', now)).toBe(7);
    expect(daysUntil('2026-08-20', now)).toBe(-6);
    expect(daysUntil('언젠가', now)).toBeNull();
  });

  it('consumableAlarmOf — 기존 알람 플로우 형태(M- 코드)로 만들어진다', () => {
    const a = consumableAlarmOf(findLineAsset('L1', 'CUTTING_UNIT'), 4.6);
    expect(a.assetId).toBe('CUTTING_UNIT');
    expect(a.code.startsWith('M-')).toBe(true);
    expect(a.title).toContain('잔량 위험');
    expect(a.detail).toContain('교체');
  });

  it('임계 상수의 순서 — crit 는 warn 보다 아래다', () => {
    expect(CONSUMABLE_CRIT_PCT).toBeLessThan(CONSUMABLE_WARN_PCT);
  });
});
