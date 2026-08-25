/**
 * 실린더 만충 계산 계약 검사.
 *  1세트 = 1회 충전, 용량(8회) 도달 시 반출 — 화면 게이지와 3D 반출 연출이
 *  전부 이 함수 하나에서 나오므로 여기서 못 박는다.
 */
import { describe, expect, it } from 'vitest';
import { CYLINDER_CAPACITY } from './factoryAssets.js';
import { computeCylinder } from './jobs.js';

describe('computeCylinder', () => {
  it('진행 중 로트가 없으면 완료분만 반영하고 비활성이다', () => {
    const c = computeCylinder(560, 0, 0, false);
    expect(c.active).toBe(false);
    expect(c.fill).toBe(560 % CYLINDER_CAPACITY);
    expect(c.discharged).toBe(Math.floor(560 / CYLINDER_CAPACITY));
  });

  it('경과시간이 택트를 넘을 때마다 1회씩 채워진다', () => {
    expect(computeCylinder(0, 0, 7.5, true).fill).toBe(0);
    expect(computeCylinder(0, 7.4, 7.5, true).fill).toBe(0);
    expect(computeCylinder(0, 7.5, 7.5, true).fill).toBe(1);
    expect(computeCylinder(0, 22.6, 7.5, true).fill).toBe(3);
  });

  it('용량에 도달하면 비워지고 반출 카운트가 올라간다 (롤오버)', () => {
    const before = computeCylinder(0, 7.5 * (CYLINDER_CAPACITY - 1), 7.5, true);
    expect(before.fill).toBe(CYLINDER_CAPACITY - 1);
    expect(before.discharged).toBe(0);

    const after = computeCylinder(0, 7.5 * CYLINDER_CAPACITY, 7.5, true);
    expect(after.fill).toBe(0);
    expect(after.discharged).toBe(1);
  });

  it('완료 로트 EA 와 현재 진행분이 이어져 계산된다', () => {
    /* 로트 완료로 produced 가 점프하는 순간에도 누적이 연속이다 */
    const duringLot = computeCylinder(120, 15, 7.5, true); // 120 + 2 = 122
    expect(duringLot.fill).toBe(122 % CYLINDER_CAPACITY);
    expect(duringLot.discharged).toBe(Math.floor(122 / CYLINDER_CAPACITY));
  });

  it('택트가 0 이거나 음수 produced 같은 이상 입력에도 죽지 않는다', () => {
    expect(computeCylinder(undefined, 100, 0, true).fill).toBe(0);
    expect(computeCylinder(-5, 0, 7.5, false).discharged).toBe(0);
  });
});
