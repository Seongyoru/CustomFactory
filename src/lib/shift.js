/**
 * =============================================================================
 *  교대(Shift) 체계 — 주간조 08:00~20:00 / 야간조 20:00~익일 08:00 (2교대 데모)
 * =============================================================================
 *  "DAY SHIFT" 정적 칩을 실동작으로: 지금이 어느 조인지, 언제 끝나는지.
 *  실공장 교대표로 바꾸려면 이 파일의 경계 시각만 교체한다. (한국 — DST 없음)
 */

const at = (base, hour) => new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour);

/** 현재 교대 — { key, label, startAt, endAt } */
export const shiftOf = (now = new Date()) => {
  const h = now.getHours();
  if (h >= 8 && h < 20) {
    return { key: 'DAY', label: '주간조', startAt: at(now, 8), endAt: at(now, 20) };
  }
  /* 야간: 20~24시는 오늘 20:00 시작, 0~8시는 어제 20:00 시작 */
  const startAt = h >= 20 ? at(now, 20) : new Date(at(now, 20).getTime() - 86_400_000);
  return { key: 'NIGHT', label: '야간조', startAt, endAt: new Date(startAt.getTime() + 12 * 3_600_000) };
};

/** 교대 종료까지 남은 초 */
export const shiftRemainSec = (now = new Date()) =>
  Math.max(0, Math.floor((shiftOf(now).endAt.getTime() - now.getTime()) / 1000));

/** 남은 시간의 짧은 표기 — '5h 12m' / '48m' */
export const fmtShiftRemain = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};
