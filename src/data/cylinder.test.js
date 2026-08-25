/**
 * 실린더 만충 계산 계약 검사.
 *  1 EA 충전 = 1/4 씩, 4회에 만충·반출 — 화면 게이지와 3D 반출 연출이
 *  전부 이 함수에서 나오므로 여기서 못 박는다.
 *  doneEaInLot 은 completedEaAt(도입/마무리 구간을 EA 로 오인하지 않는 역함수)로
 *  구해 넣는다 — 그 계약은 processTiming.test.js 에 있다.
 */
import { describe, expect, it } from 'vitest';
import { CYLINDER_CAPACITY } from './factoryAssets.js';
import { computeCylinder } from './jobs.js';

describe('computeCylinder', () => {
  it('용량은 4 (현장 확인: 4회 충전 = 완충)', () => {
    expect(CYLINDER_CAPACITY).toBe(4);
  });

  it('진행 중 로트가 없으면 완료분만 반영하고 비활성이다', () => {
    const c = computeCylinder(10, 0, false);
    expect(c.active).toBe(false);
    expect(c.fill).toBe(10 % CYLINDER_CAPACITY);
    expect(c.discharged).toBe(Math.floor(10 / CYLINDER_CAPACITY));
  });

  it('충전 완료 EA 만큼 채워진다', () => {
    expect(computeCylinder(0, 0, true).fill).toBe(0);
    expect(computeCylinder(0, 3, true).fill).toBe(3);
  });

  it('용량 도달 시 비워지고 반출 카운트가 올라간다 (롤오버)', () => {
    const before = computeCylinder(0, CYLINDER_CAPACITY - 1, true);
    expect(before.fill).toBe(CYLINDER_CAPACITY - 1);
    expect(before.discharged).toBe(0);

    const after = computeCylinder(0, CYLINDER_CAPACITY, true);
    expect(after.fill).toBe(0);
    expect(after.discharged).toBe(1);
  });

  it('완료 로트 EA 와 현재 진행분이 이어져 계산된다', () => {
    const c = computeCylinder(10, 3, true); // 누적 13
    expect(c.fill).toBe(13 % CYLINDER_CAPACITY);
    expect(c.discharged).toBe(Math.floor(13 / CYLINDER_CAPACITY));
  });

  it('이상 입력(음수·undefined)에도 죽지 않는다', () => {
    expect(computeCylinder(undefined, undefined, true).fill).toBe(0);
    expect(computeCylinder(-5, -1, false).discharged).toBe(0);
  });
});
