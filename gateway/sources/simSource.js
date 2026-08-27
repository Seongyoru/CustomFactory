/**
 * 게이트웨이 내장 시뮬레이터 소스 — PLC 가 없는 환경에서 게이트웨이 경로 전체
 * (WS 접속·재접속·프레임 파싱·화면 반영)를 시연·검증할 때 쓴다.
 * 프론트 시뮬레이션 소스와 같은 기준값을 import 해 화면 판정(정상/주의)과 어긋나지 않는다.
 */
import { PRODUCTION_LINES, SELECTABLE_ASSETS } from '../../src/data/factoryAssets.js';
import { TELEMETRY_BASELINES } from '../../src/telemetry/simulatedSource.js';

export function createSimSource() {
  const state = {};
  for (const line of PRODUCTION_LINES) {
    state[line.id] = {};
    for (const asset of SELECTABLE_ASSETS) {
      const base = TELEMETRY_BASELINES[asset.id] ?? { temp: 40, vib: 2, amp: 6 };
      state[line.id][asset.id] = {
        temp: base.temp * (0.96 + Math.random() * 0.08),
        vib: base.vib * (0.9 + Math.random() * 0.2),
        amp: base.amp * (0.92 + Math.random() * 0.16),
      };
    }
  }

  let lastTickAt = Date.now();
  setInterval(() => {
    lastTickAt = Date.now();
    for (const line of PRODUCTION_LINES) {
      for (const asset of SELECTABLE_ASSETS) {
        const base = TELEMETRY_BASELINES[asset.id] ?? { temp: 40, vib: 2, amp: 6 };
        const cur = state[line.id][asset.id];
        cur.temp += (base.temp - cur.temp) * 0.06 + (Math.random() - 0.5) * 0.5;
        cur.vib = Math.max(0, cur.vib + (base.vib - cur.vib) * 0.22 + (Math.random() - 0.5) * base.vib * 0.14);
        cur.amp = Math.max(0, cur.amp + (base.amp - cur.amp) * 0.2 + (Math.random() - 0.5) * base.amp * 0.1);
      }
    }
  }, 1000);

  return {
    snapshot() {
      const readings = {};
      for (const line of PRODUCTION_LINES) {
        readings[line.id] = {};
        for (const asset of SELECTABLE_ASSETS) {
          const cur = state[line.id][asset.id];
          readings[line.id][asset.id] = {
            temp: +cur.temp.toFixed(2),
            vib: +cur.vib.toFixed(3),
            amp: +cur.amp.toFixed(2),
          };
        }
      }
      return { readings, ageMs: Date.now() - lastTickAt };
    },
  };
}
