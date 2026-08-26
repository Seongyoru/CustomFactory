import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_LINES,
  SELECTABLE_ASSETS,
  STATUS,
  findAsset,
} from './factoryAssets.js';
import {
  LINE_ASSET_OVERRIDES,
  findLineAsset,
  lineSelectableAssets,
  memoKeyOf,
} from './lineAssets.js';

describe('lineAssets — 라인별 설비 인스턴스 마스터', () => {
  it('오버라이드 테이블의 라인·설비 ID 는 전부 실제 마스터에 존재한다 (오타 가드)', () => {
    const lineIds = new Set(PRODUCTION_LINES.map((l) => l.id));
    for (const [lineId, byAsset] of Object.entries(LINE_ASSET_OVERRIDES)) {
      expect(lineIds.has(lineId), `unknown line ${lineId}`).toBe(true);
      for (const assetId of Object.keys(byAsset)) {
        expect(findAsset(assetId), `unknown asset ${assetId}`).not.toBeNull();
      }
    }
  });

  it('L2 는 선택 가능 설비 전체의 인스턴스 값을 갖고, status 키는 유효하다', () => {
    const l2 = LINE_ASSET_OVERRIDES.L2;
    for (const a of SELECTABLE_ASSETS) {
      const inst = l2[a.id];
      expect(inst, `L2 missing ${a.id}`).toBeTruthy();
      /* 인스턴스 고유 필드가 빠짐없이 정의돼야 형식 값이 새어 나오지 않는다 */
      for (const field of ['sn', 'mfgDate', 'installedAt', 'lastCheck', 'nextCheck', 'status', 'consumable', 'history']) {
        expect(inst[field], `L2.${a.id}.${field}`).toBeTruthy();
      }
      expect(STATUS[inst.status], `L2.${a.id}.status=${inst.status}`).toBeTruthy();
      expect(inst.sn).not.toBe(a.sn); // 호기가 다르면 시리얼도 다르다
    }
  });

  it('findLineAsset — 형식 값 위에 인스턴스 값이 병합되고 lineId 가 박힌다', () => {
    const l1 = findLineAsset('L1', 'CUTTING_UNIT');
    const l2 = findLineAsset('L2', 'CUTTING_UNIT');
    /* 형식 공통 값은 같다 */
    expect(l2.model).toBe(l1.model);
    expect(l2.nameKo).toBe(l1.nameKo);
    expect(l2.maker).toBe(l1.maker);
    /* 인스턴스 값은 다르다 — L1 은 마스터 원본(톱날 10% 경고), L2 는 신품 */
    expect(l1.sn).toBe(findAsset('CUTTING_UNIT').sn);
    expect(l2.sn).not.toBe(l1.sn);
    expect(l1.consumable.percent).toBe(10);
    expect(l2.consumable.percent).toBeGreaterThan(50);
    expect(l1.lineId).toBe('L1');
    expect(l2.lineId).toBe('L2');
  });

  it('findLineAsset — 모르는 설비는 null, 모르는 라인은 형식 값 폴백', () => {
    expect(findLineAsset('L1', 'NOPE')).toBeNull();
    expect(findLineAsset('L1', null)).toBeNull();
    const ghost = findLineAsset('L9', 'CONVEYOR_UNIT');
    expect(ghost.sn).toBe(findAsset('CONVEYOR_UNIT').sn);
    expect(ghost.lineId).toBe('L9');
  });

  it('lineSelectableAssets — 선택 가능 설비와 같은 목록·같은 순서', () => {
    for (const line of PRODUCTION_LINES) {
      const list = lineSelectableAssets(line.id);
      expect(list.map((a) => a.id)).toEqual(SELECTABLE_ASSETS.map((a) => a.id));
      expect(list.every((a) => a.lineId === line.id)).toBe(true);
    }
  });

  it('memoKeyOf — 라인과 설비를 함께 식별한다', () => {
    expect(memoKeyOf('L2', 'CART_UNIT')).toBe('L2:CART_UNIT');
    expect(memoKeyOf('L1', 'CART_UNIT')).not.toBe(memoKeyOf('L2', 'CART_UNIT'));
  });
});
