/**
 * 공정 애니메이션 스케줄 계약 검사 (키프레임 명세: 현장 확인 2026-08-25).
 *  컨베이어 1회 도착 = 원자재 8개 = 충전 8회 = 실린더 1개.
 *  설비별 세그먼트 재생(clipTimeFor)이 명세와 어긋나면 여기서 잡는다.
 *  프레임 기준: TOTAL 클립 30fps · 216f.
 */
import { describe, expect, it } from 'vitest';
import {
  CLIP_FPS,
  CYCLE_FRAMES,
  FILL_REPEATS,
  PROCESS_CYCLE_SEC,
  PROCESS_PHASES,
  REPEAT_PERIOD_F,
  busyFramesOf,
  clipTimeFor,
} from './factoryAssets.js';

const f = (frame) => frame / CLIP_FPS; // 프레임 → 초
const atFrame = (assetId, masterFrame) => clipTimeFor(assetId, f(masterFrame)) * CLIP_FPS;

const REPEATS_END_F = 140 + FILL_REPEATS * REPEAT_PERIOD_F; // 748

describe('clipTimeFor — 키프레임 명세', () => {
  it('컨베이어: 0~40 도착 후 정지, 반복이 끝나면 50~95 출발', () => {
    expect(atFrame('CONVEYOR_UNIT', 0)).toBeCloseTo(0);
    expect(atFrame('CONVEYOR_UNIT', 40)).toBeCloseTo(40);
    expect(atFrame('CONVEYOR_UNIT', 300)).toBeCloseTo(40); // 반복 구간 내내 정지
    expect(atFrame('CONVEYOR_UNIT', REPEATS_END_F)).toBeCloseTo(50); // 출발 시작
    expect(atFrame('CONVEYOR_UNIT', CYCLE_FRAMES)).toBeCloseTo(95); // 출발 완료
  });

  it('이재 로봇: 30프레임부터 30~85 를 8회 반복 (76f 주기)', () => {
    expect(atFrame('LOAD_TRANSFER_ROBOT', 0)).toBeCloseTo(30); // 시작 전 — 시작 포즈
    expect(atFrame('LOAD_TRANSFER_ROBOT', 30)).toBeCloseTo(30);
    expect(atFrame('LOAD_TRANSFER_ROBOT', 85)).toBeCloseTo(85); // 1회차 종료
    expect(atFrame('LOAD_TRANSFER_ROBOT', 100)).toBeCloseTo(85); // 다음 회차까지 대기
    expect(atFrame('LOAD_TRANSFER_ROBOT', 30 + REPEAT_PERIOD_F)).toBeCloseTo(30); // 2회차 재시작
    /* 마지막 회차 이후에는 끝 포즈 고정 */
    expect(atFrame('LOAD_TRANSFER_ROBOT', CYCLE_FRAMES)).toBeCloseTo(85);
  });

  it('절단기: 77부터 77~146 ×8 · 폴리: 140부터 140~216 ×8 (주기와 같아 연속)', () => {
    expect(atFrame('CUTTING_UNIT', 77)).toBeCloseTo(77);
    expect(atFrame('CUTTING_UNIT', 77 + REPEAT_PERIOD_F)).toBeCloseTo(77);
    expect(atFrame('POLY_ROBOT', 140)).toBeCloseTo(140);
    expect(atFrame('POLY_ROBOT', 140 + REPEAT_PERIOD_F - 1)).toBeCloseTo(215);
    expect(atFrame('POLY_ROBOT', 140 + REPEAT_PERIOD_F)).toBeCloseTo(140); // 바로 다음 충전
    expect(atFrame('POLY_ROBOT', REPEATS_END_F)).toBeCloseTo(216); // 마지막 충전 종료
  });

  it('카트: 140~175 진입 고정 → 176~187 충전 수용 ×8 → 반복 종료 후 188~203 반출', () => {
    expect(atFrame('CART_UNIT', 140)).toBeCloseTo(140);
    expect(atFrame('CART_UNIT', 175)).toBeCloseTo(175); // 진입 완료 고정
    expect(atFrame('CART_UNIT', 176)).toBeCloseTo(176); // 1회차 충전 수용
    expect(atFrame('CART_UNIT', 200)).toBeCloseTo(187); // 다음 충전까지 대기
    expect(atFrame('CART_UNIT', 176 + REPEAT_PERIOD_F)).toBeCloseTo(176); // 2회차
    expect(atFrame('CART_UNIT', REPEATS_END_F)).toBeCloseTo(188); // 만충 반출 시작
    expect(atFrame('CART_UNIT', REPEATS_END_F + 15)).toBeCloseTo(203); // 반출 완료
  });

  it('팝업: 150~157 위치 결정 고정 → 반복 종료 후 195~202 리커버리', () => {
    expect(atFrame('POPUP_UNIT', 150)).toBeCloseTo(150);
    expect(atFrame('POPUP_UNIT', 157)).toBeCloseTo(157);
    expect(atFrame('POPUP_UNIT', 400)).toBeCloseTo(157); // 작업 내내 고정
    expect(atFrame('POPUP_UNIT', REPEATS_END_F + 7)).toBeCloseTo(195);
    expect(atFrame('POPUP_UNIT', REPEATS_END_F + 14)).toBeCloseTo(202);
  });

  it('스케줄 없는 배경 설비는 첫 포즈(0) 고정', () => {
    expect(clipTimeFor('FENCE_UNIT', 5)).toBe(0);
    expect(clipTimeFor('DOPANT_BRIDGE', 20)).toBe(0);
  });
});

describe('사이클 구조', () => {
  it('라인 1사이클 = 실린더 1개 = 충전 8회, 컨베이어 출발로 끝난다', () => {
    expect(FILL_REPEATS).toBe(8);
    expect(CYCLE_FRAMES).toBe(REPEATS_END_F + 45);
    expect(PROCESS_CYCLE_SEC).toBeCloseTo(CYCLE_FRAMES / CLIP_FPS);
  });

  it('병목은 폴리 로봇 (실가동 프레임 최대)', () => {
    const ids = ['CONVEYOR_UNIT', 'LOAD_TRANSFER_ROBOT', 'CUTTING_UNIT', 'POLY_ROBOT', 'CART_UNIT', 'POPUP_UNIT'];
    const max = Math.max(...ids.map(busyFramesOf));
    expect(busyFramesOf('POLY_ROBOT')).toBe(max);
    expect(busyFramesOf('POLY_ROBOT')).toBe(FILL_REPEATS * 76);
  });

  it('HUD 단계는 전부 사이클 범위 안에 있고 시작 순으로 정렬돼 있다', () => {
    PROCESS_PHASES.forEach((p) => {
      expect(p.start).toBeGreaterThanOrEqual(0);
      expect(p.end).toBeLessThanOrEqual(PROCESS_CYCLE_SEC + 1e-6);
      expect(p.end).toBeGreaterThan(p.start);
    });
    const starts = PROCESS_PHASES.map((p) => p.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});
