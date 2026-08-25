/**
 * =============================================================================
 *  시간/숫자 포맷터 — "시간이 흘러가는" 표현의 단일 소스
 * =============================================================================
 */

/**
 * 시뮬레이션 배속 단계.
 *  슬라이더가 값이 아니라 '인덱스'를 다루기 때문에 간격이 불균등해도(0.25 → 1 → 4)
 *  눈금이 균등하게 찍힌다. 저속 구간을 촘촘히 두어 공정 동작을 뜯어볼 수 있게 했다.
 */
export const SPEED_STEPS = [0.25, 0.5, 0.75, 1, 2, 3, 4];

export const pad = (n) => String(Math.floor(n)).padStart(2, '0');

export const fmtDuration = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)} : ${pad(s % 60)}`;
};

/** "2시간 11분" 처럼 사람이 읽는 소요 시간. 완료 '시각'과 구분해서 쓴다. */
export const fmtKoDuration = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  if (m > 0) return `${m}분`;
  return `${s}초`;
};

export const fmtClock = (d, withSeconds = true) =>
  `${pad(d.getHours())}:${pad(d.getMinutes())}${withSeconds ? `:${pad(d.getSeconds())}` : ''}`;

export const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 0.25 를 toFixed(1) 로 찍으면 "0.3" 이 되어버린다. 단계값은 그대로 보여준다. */
export const fmtSpeed = (v) => String(v);

/**
 * 3D 재생 배속의 '표시값'.
 *  내부 값은 택트타임에서 나온 실수(예: ×0.96)라 화면에 그대로 찍으면 어긋난 값처럼 보인다.
 *  택트 몇 % 차이는 눈으로 구분되지 않으므로 가장 가까운 배속 단계로 반올림해 보여준다.
 *  단순 Math.round 를 쓰면 0.25배속(내부 0.24)이 "×0" 이 되므로 단계값에 맞춘다.
 *  ※ 표시만 다듬는 것이고 실제 재생 속도는 반올림하지 않는다.
 */
const MAX_SPEED_STEP = SPEED_STEPS[SPEED_STEPS.length - 1];
export const fmtAnimScale = (v) => {
  if (v > MAX_SPEED_STEP) return fmtSpeed(Math.round(v)); // 단계 범위를 벗어나면 정수 반올림
  const nearest = SPEED_STEPS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best));
  return fmtSpeed(nearest);
};

export const fmtSec = (v) => `${v.toFixed(2)}s`;

export const fmtKoDateTime = (d) =>
  `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours() < 12 ? '오전' : '오후'} ` +
  `${pad(d.getHours() % 12 || 12)}:${pad(d.getMinutes())}`;
