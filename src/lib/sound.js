/**
 * =============================================================================
 *  사운드 — Web Audio 합성 (오디오 파일 불필요)
 * =============================================================================
 *  관제 화면의 청각 피드백 3종을 오실레이터로 즉석 합성한다:
 *   alarm    설비 알람 — 두 음 교차 경고음 2회
 *   complete 로트 완료 — 밝은 상승 딩
 *   estop    비상 정지 — 낮고 둔탁한 톤
 *  브라우저 자동재생 정책상 AudioContext 는 사용자 제스처 이후에만 소리가 난다 —
 *  대시보드가 첫 pointerdown 에서 unlockAudio() 를 불러 잠금을 푼다.
 *  음소거는 GNB 스피커 토글(ui.sound)이 제어한다. 실패는 전부 무해하게 삼킨다.
 */

let ctx = null;

const getCtx = () => {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
};

/** 첫 사용자 제스처에서 호출 — 자동재생 잠금 해제 */
export const unlockAudio = () => {
  getCtx();
};

/* 단일 톤 — 어택/릴리즈 엔벨로프로 딱딱거림 없이 */
const tone = (c, { freq, at, dur, type = 'sine', peak = 0.06 }) => {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + at);
  gain.gain.setValueAtTime(0, c.currentTime + at);
  gain.gain.linearRampToValueAtTime(peak, c.currentTime + at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime + at);
  osc.stop(c.currentTime + at + dur + 0.05);
};

/** 설비 알람 — 삐-삐 두 음 교차 ×2 (긴급하지만 시끄럽지 않게) */
export const playAlarm = () => {
  const c = getCtx();
  if (!c) return;
  [0, 0.22, 0.44, 0.66].forEach((at, i) =>
    tone(c, { freq: i % 2 === 0 ? 880 : 660, at, dur: 0.18, type: 'square', peak: 0.045 })
  );
};

/** 로트 완료 — 밝은 상승 딩 */
export const playComplete = () => {
  const c = getCtx();
  if (!c) return;
  tone(c, { freq: 880, at: 0, dur: 0.12 });
  tone(c, { freq: 1318.5, at: 0.1, dur: 0.28 });
};

/** 비상 정지 — 낮고 둔탁하게 */
export const playEstop = () => {
  const c = getCtx();
  if (!c) return;
  tone(c, { freq: 196, at: 0, dur: 0.5, type: 'sawtooth', peak: 0.07 });
  tone(c, { freq: 98, at: 0.05, dur: 0.5, type: 'sine', peak: 0.06 });
};
