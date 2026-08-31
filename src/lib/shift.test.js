/** 교대 체계 경계 검사 */
import { describe, expect, it } from 'vitest';
import { fmtShiftRemain, shiftOf, shiftRemainSec } from './shift.js';

const d = (h, m = 0) => new Date(2026, 7, 27, h, m);

describe('shift — 2교대 판정', () => {
  it('주간조: 08:00 포함 ~ 20:00 미포함', () => {
    expect(shiftOf(d(8, 0)).key).toBe('DAY');
    expect(shiftOf(d(19, 59)).key).toBe('DAY');
    expect(shiftOf(d(20, 0)).key).toBe('NIGHT');
    expect(shiftOf(d(7, 59)).key).toBe('NIGHT');
  });

  it('야간조는 자정을 넘는다 — 00:30 의 시작은 어제 20:00', () => {
    const s = shiftOf(new Date(2026, 7, 27, 0, 30));
    expect(s.key).toBe('NIGHT');
    expect(s.startAt).toEqual(new Date(2026, 7, 26, 20, 0));
    expect(s.endAt).toEqual(new Date(2026, 7, 27, 8, 0));
  });

  it('23시의 야간조 종료는 익일 08:00', () => {
    const s = shiftOf(d(23));
    expect(s.endAt).toEqual(new Date(2026, 7, 28, 8, 0));
  });

  it('잔여 시간 — 19:00 주간조는 3600초 남음', () => {
    expect(shiftRemainSec(d(19, 0))).toBe(3600);
    expect(fmtShiftRemain(3600)).toBe('1h 00m');
    expect(fmtShiftRemain(48 * 60)).toBe('48m');
  });
});
