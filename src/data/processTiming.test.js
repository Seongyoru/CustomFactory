/**
 * 공정 애니메이션 스케줄 계약 검사 (현장 명세 2026-08-25 v2).
 *  - 컨베이어 적재 최대 20개, 로트 잔여만큼만 싣는다 (반복 횟수 = 적재 수)
 *  - 실린더는 4회 충전이 완충 — 카트 수용 연출 4단계(176-178/…/185-187),
 *    4회째마다 188~203 반출
 *  - 로트 표준시간 = 애니메이션 유도: 수량 1개면 도입+1회+마무리 전체,
 *    2개부터는 택트만큼씩 추가. 공정 완료 = 애니메이션 완료.
 *  프레임 기준: TOTAL 클립 30fps · 216f.
 */
import { describe, expect, it } from 'vitest';
import {
  CLIP_FPS,
  CONVEYOR_LOAD_MAX,
  CYLINDER_CAPACITY,
  REPEAT_PERIOD_F,
  busyFramesOf,
  clipTimeFor,
  completedEaAt,
  currentLoadAt,
  cycleFramesFor,
  cycleSecFor,
  loadPlanFor,
  lotTotalSec,
  processPhasesFor,
} from './factoryAssets.js';

const f = (frame) => frame / CLIP_FPS;
const atFrame = (assetId, masterFrame, n) => clipTimeFor(assetId, f(masterFrame), n) * CLIP_FPS;

describe('로드 계획과 표준시간 — 애니메이션 유도', () => {
  it('로트 수량을 20개 단위 로드로 나눈다', () => {
    expect(loadPlanFor(1)).toEqual([1]);
    expect(loadPlanFor(20)).toEqual([20]);
    expect(loadPlanFor(50)).toEqual([20, 20, 10]);
  });

  it('수량 1개 = 도입+1회+마무리 전체 애니메이션 시간', () => {
    /* 사이클 (185+76)/76 × 택트 = 3.43×택트 */
    expect(lotTotalSec(1, 7.6)).toBe(Math.round((7.6 * cycleFramesFor(1)) / REPEAT_PERIOD_F));
    expect(lotTotalSec(1, 7.6)).toBeGreaterThan(7.6 * 3); // 단순 택트×1 보다 훨씬 길다
  });

  it('로드 안에서는 1개 늘 때마다 정확히 택트만큼 늘어난다', () => {
    const takt = 7.6;
    const t5 = (takt * cycleFramesFor(5)) / REPEAT_PERIOD_F;
    const t6 = (takt * cycleFramesFor(6)) / REPEAT_PERIOD_F;
    expect(t6 - t5).toBeCloseTo(takt, 6);
  });

  it('로드가 늘면 도입+마무리 오버헤드가 로드마다 더해진다', () => {
    const takt = 7.6;
    expect(lotTotalSec(40, takt)).toBeGreaterThan(lotTotalSec(20, takt) * 2 - 2);
  });

  it('completedEaAt 는 lotTotalSec 의 역함수다', () => {
    const takt = 7.5;
    expect(completedEaAt(0, 10, takt)).toBe(0);
    /* 도입 구간(첫 충전 전)에는 0 이어야 한다 — 도입을 EA 로 오인하지 않음 */
    expect(completedEaAt((takt * 150) / REPEAT_PERIOD_F, 10, takt)).toBe(0);
    expect(completedEaAt(lotTotalSec(10, takt), 10, takt)).toBe(10);
    expect(completedEaAt(lotTotalSec(50, takt), 50, takt)).toBe(50);
  });

  it('currentLoadAt 는 로드 경계에서 반복 횟수를 바꾼다', () => {
    const takt = 7.5;
    expect(currentLoadAt(0, 50, takt).repeats).toBe(20);
    const firstLoadDur = (takt * cycleFramesFor(20)) / REPEAT_PERIOD_F;
    expect(currentLoadAt(firstLoadDur * 2 + 1, 50, takt).repeats).toBe(10); // 마지막 부분 로드
    expect(currentLoadAt(0, 3, takt).repeats).toBe(3);
  });
});

describe('clipTimeFor — 설비별 세그먼트 재생 (적재 n 기준)', () => {
  it('컨베이어: 0~40 도착 정지, 반복 끝나면 50~95 출발', () => {
    expect(atFrame('CONVEYOR_UNIT', 0, 5)).toBeCloseTo(0);
    expect(atFrame('CONVEYOR_UNIT', 40, 5)).toBeCloseTo(40);
    expect(atFrame('CONVEYOR_UNIT', 300, 5)).toBeCloseTo(40); // 반복 중 정지
    const endF = 140 + 5 * REPEAT_PERIOD_F;
    expect(atFrame('CONVEYOR_UNIT', endF, 5)).toBeCloseTo(50);
    expect(atFrame('CONVEYOR_UNIT', endF + 45, 5)).toBeCloseTo(95);
  });

  it('이재 로봇: 30~85 를 적재 수만큼 반복', () => {
    expect(atFrame('LOAD_TRANSFER_ROBOT', 30, 3)).toBeCloseTo(30);
    expect(atFrame('LOAD_TRANSFER_ROBOT', 85, 3)).toBeCloseTo(85);
    expect(atFrame('LOAD_TRANSFER_ROBOT', 30 + REPEAT_PERIOD_F, 3)).toBeCloseTo(30); // 2회차
    /* 3회면 3회 뒤에는 끝 포즈 고정 */
    expect(atFrame('LOAD_TRANSFER_ROBOT', 30 + 3 * REPEAT_PERIOD_F, 3)).toBeCloseTo(85);
  });

  it('카트: 충전 수용이 실린더 단계(4회 완충)별 3프레임 구간으로 나뉜다', () => {
    /* k회째 충전 → 클립 [176+3(k%4) ~ 178+3(k%4)] */
    expect(atFrame('CART_UNIT', 176, 20)).toBeCloseTo(176); // 1회 → 176~178
    expect(atFrame('CART_UNIT', 176 + REPEAT_PERIOD_F, 20)).toBeCloseTo(179); // 2회 → 179~181
    expect(atFrame('CART_UNIT', 176 + 2 * REPEAT_PERIOD_F, 20)).toBeCloseTo(182); // 3회
    expect(atFrame('CART_UNIT', 176 + 3 * REPEAT_PERIOD_F, 20)).toBeCloseTo(185); // 4회 → 만충
  });

  it('4회째 충전 직후 실린더 반출(188~203)이 재생된다', () => {
    const k = CYLINDER_CAPACITY - 1; // 4회째 (k=3)
    const exitAt = 180 + k * REPEAT_PERIOD_F;
    expect(atFrame('CART_UNIT', exitAt, 20)).toBeCloseTo(188);
    expect(atFrame('CART_UNIT', exitAt + 15, 20)).toBeCloseTo(203);
    /* 다음 회차(5회째)에는 새 실린더 1단계부터 */
    expect(atFrame('CART_UNIT', 176 + 4 * REPEAT_PERIOD_F, 20)).toBeCloseTo(176);
  });

  it('스케줄 없는 배경 설비는 첫 포즈(0) 고정', () => {
    expect(clipTimeFor('FENCE_UNIT', 5, 20)).toBe(0);
    expect(clipTimeFor('DOPANT_BRIDGE', 20, 20)).toBe(0);
  });
});

describe('사이클 구조·병목·HUD', () => {
  it('사이클 길이 = (185 + 76×적재수) 프레임', () => {
    expect(cycleFramesFor(1)).toBe(185 + 76);
    expect(cycleFramesFor(20)).toBe(185 + 76 * 20);
    expect(cycleSecFor(20)).toBeCloseTo(cycleFramesFor(20) / CLIP_FPS);
  });

  it('병목은 폴리 로봇 (만재 기준 실가동 최대)', () => {
    const ids = ['CONVEYOR_UNIT', 'LOAD_TRANSFER_ROBOT', 'CUTTING_UNIT', 'POLY_ROBOT', 'CART_UNIT', 'POPUP_UNIT'];
    const max = Math.max(...ids.map((id) => busyFramesOf(id, CONVEYOR_LOAD_MAX)));
    expect(busyFramesOf('POLY_ROBOT', CONVEYOR_LOAD_MAX)).toBe(max);
  });

  it('HUD 단계는 핵심 흐름만 담고 사이클 범위 안에 있다', () => {
    const phases = processPhasesFor(CONVEYOR_LOAD_MAX);
    const labels = phases.map((p) => p.label);
    /* 보조 동작(카트 위치 결정·리커버리 등)은 HUD 에서 뺀다 — 사용자 요청 */
    expect(labels.some((l) => l.includes('위치 결정'))).toBe(false);
    expect(labels.some((l) => l.includes('리커버리'))).toBe(false);
    expect(labels.some((l) => l.includes('만충 반출'))).toBe(true);
    phases.forEach((p) => {
      expect(p.start).toBeGreaterThanOrEqual(0);
      expect(p.end).toBeLessThanOrEqual(cycleSecFor(CONVEYOR_LOAD_MAX) + 1e-6);
    });
    /* 적재 수가 4 미만이면 만충이 없어 반출 단계도 없다 */
    expect(processPhasesFor(3).some((p) => p.label.includes('반출'))).toBe(false);
  });
});
