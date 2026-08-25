/**
 * 공정 애니메이션 재타이밍 계약 검사.
 *  실제 공정: 컨베이어가 이재 로봇 앞에 도착해 '정지한 뒤' 로봇이 집는다.
 *  GLB 를 다시 굽지 않고 설비별 재생 시각 매핑(clipTimeFor)으로 이를 재현하므로,
 *  매핑 수식과 단계표(PROCESS_PHASES)가 어긋나면 여기서 잡는다.
 */
import { describe, expect, it } from 'vitest';
import {
  CLIP_SEC,
  PROCESS_CYCLE_SEC,
  PROCESS_PHASES,
  SEQUENCE_DELAY_SEC,
  clipTimeFor,
} from './factoryAssets.js';

/* GLB "TOTAL" 클립에 구워진 원본 구간 (키프레임 실측값 — 클립 기준) */
const BAKED = {
  CONVEYOR_UNIT: [0.0, 3.17],
  LOAD_TRANSFER_ROBOT: [1.0, 2.83],
  CUTTING_UNIT: [2.57, 4.87],
  CART_UNIT: [4.67, 6.77],
  POPUP_UNIT: [5.0, 6.73],
  POLY_ROBOT: [4.67, 7.2],
};

const phase = (id) => PROCESS_PHASES.find((p) => p.id === id);

describe('clipTimeFor — 설비별 재생 시각 매핑', () => {
  it('컨베이어는 라인 시각 그대로, 클립 길이에서 고정된다', () => {
    expect(clipTimeFor('CONVEYOR_UNIT', 0)).toBe(0);
    expect(clipTimeFor('CONVEYOR_UNIT', 3.17)).toBeCloseTo(3.17);
    expect(clipTimeFor('CONVEYOR_UNIT', PROCESS_CYCLE_SEC)).toBe(CLIP_SEC);
  });

  it('이재 로봇은 컨베이어 정지 시점(3.17s)에 정확히 구움 시작점(1.0s)에 닿는다', () => {
    expect(clipTimeFor('LOAD_TRANSFER_ROBOT', 3.17)).toBeCloseTo(1.0);
    /* 그 전에는 아직 동작 구간(1.0s) 이전 — 정지 포즈 */
    expect(clipTimeFor('LOAD_TRANSFER_ROBOT', 2.0)).toBeLessThan(1.0);
    expect(clipTimeFor('LOAD_TRANSFER_ROBOT', 0)).toBe(0);
  });

  it('사이클 끝(9.37s)에 후공정 클립이 정확히 끝(7.2s)에 닿는다', () => {
    expect(clipTimeFor('POLY_ROBOT', PROCESS_CYCLE_SEC)).toBeCloseTo(CLIP_SEC);
  });

  it('라인 사이클 = 클립 길이 + 후공정 지연', () => {
    expect(PROCESS_CYCLE_SEC).toBeCloseTo(CLIP_SEC + SEQUENCE_DELAY_SEC);
  });
});

describe('PROCESS_PHASES — 단계표와 매핑의 일치', () => {
  it('각 단계의 시작·끝이 구워진 구간으로 정확히 매핑된다', () => {
    Object.entries(BAKED).forEach(([id, [bs, be]]) => {
      const p = phase(id);
      expect(p, id).toBeTruthy();
      expect(clipTimeFor(id, p.start), `${id} start`).toBeCloseTo(bs, 5);
      expect(clipTimeFor(id, p.end), `${id} end`).toBeCloseTo(be, 5);
    });
  });

  it('모든 단계가 라인 사이클 범위 안에 있다', () => {
    PROCESS_PHASES.forEach((p) => {
      expect(p.start).toBeGreaterThanOrEqual(0);
      expect(p.end).toBeLessThanOrEqual(PROCESS_CYCLE_SEC + 1e-9);
      expect(p.end).toBeGreaterThan(p.start);
    });
  });

  it('실제 공정 순서: 컨베이어 정지 → 이재 → 절단 → 카트/팝업/충전', () => {
    const conveyor = phase('CONVEYOR_UNIT');
    const robot = phase('LOAD_TRANSFER_ROBOT');
    const cutting = phase('CUTTING_UNIT');
    const cart = phase('CART_UNIT');
    const popup = phase('POPUP_UNIT');
    const poly = phase('POLY_ROBOT');

    /* 로봇은 컨베이어가 완전히 멈춘 뒤에야 움직인다 — 이번 수정의 핵심 */
    expect(robot.start).toBeGreaterThanOrEqual(conveyor.end);
    /* 절단은 로봇 인수인계 구간(구워진 0.26s 겹침)을 유지한 채 로봇 뒤를 따른다 */
    expect(cutting.start).toBeGreaterThan(robot.start);
    expect(cutting.start).toBeLessThanOrEqual(robot.end);
    /* 카트 진입 후 팝업이 위치를 잡는다 */
    expect(popup.start).toBeGreaterThan(cart.start);
    /* 충전(폴리)은 절단이 버켓을 채운 뒤의 인수인계 구간에서 시작한다 */
    expect(poly.start).toBeGreaterThan(cutting.start);
  });
});
