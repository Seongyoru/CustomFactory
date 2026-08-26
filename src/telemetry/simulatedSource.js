/**
 * =============================================================================
 *  텔레메트리 데이터 소스 — 시뮬레이션 구현
 * =============================================================================
 *  [ 소스 인터페이스 ]
 *   모든 소스는 아래 형태를 따른다. 실제 OPC-UA/MQTT 게이트웨이 연동 시
 *   이 파일과 같은 인터페이스의 어댑터를 만들어 갈아끼우면 화면 코드는
 *   그대로 동작한다.
 *
 *     createXxxSource({ getContext }) → {
 *       info: { id, label, protocol },
 *       subscribe(listener): unsubscribe,   // listener({ at, readings, latencyMs })
 *       start(), stop(),
 *     }
 *
 *   readings 형태: { [lineId]: { [assetId]: { temp, vib, amp } } }
 *     temp — 구동부 온도 (°C)
 *     vib  — 진동 속도 RMS (mm/s)
 *     amp  — 모터 전류 (A)
 *
 *  [ 시뮬레이션 모델 ]
 *   OU(Ornstein-Uhlenbeck) 방식의 랜덤워크로 설비별 기준값 주변을 배회한다.
 *   앱 상태(getContext)에 반응한다:
 *     - 라인 정지(E-STOP)/유휴 → 주변 온도(24°C)·무부하 값으로 서서히 식는다
 *     - 오류 설비              → 진동 ×3 / 전류 ×1.6 / 온도 +18°C 로 치솟는다
 * ---------------------------------------------------------------------------
 */
import { PRODUCTION_LINES, SELECTABLE_ASSETS } from '../data/factoryAssets.js';

/** 설비별 정상 가동 기준값 */
export const TELEMETRY_BASELINES = {
  CUTTING_UNIT: { temp: 58, vib: 4.2, amp: 12.5 },
  CONVEYOR_UNIT: { temp: 41, vib: 2.1, amp: 6.8 },
  CART_UNIT: { temp: 35, vib: 1.2, amp: 4.2 },
  LOAD_TRANSFER_ROBOT: { temp: 47, vib: 2.8, amp: 8.9 },
  POLY_ROBOT: { temp: 45, vib: 2.5, amp: 7.6 },
  POPUP_UNIT: { temp: 38, vib: 1.8, amp: 5.4 },
};

/** 무부하(정지) 수렴값 */
const AMBIENT = { temp: 24, vib: 0.1, amp: 0.4 };

/** 지표별 표시 단위/자릿수 — UI 공용 */
export const TELEMETRY_METRICS = [
  { key: 'temp', label: '구동부 온도', unit: '°C', digits: 1 },
  { key: 'vib', label: '진동 (RMS)', unit: 'mm/s', digits: 2 },
  { key: 'amp', label: '모터 전류', unit: 'A', digits: 1 },
];

/**
 * 지표 판정 — 기준값 대비 비율로 정상/주의/위험을 가른다.
 * 실제 연동 시에는 설비별 임계값 테이블로 교체한다.
 */
export function metricStatus(assetId, key, value) {
  const base = TELEMETRY_BASELINES[assetId]?.[key];
  if (!base) return 'ok';
  const ratio = value / base;
  if (ratio >= 1.8) return 'crit';
  if (ratio >= 1.25) return 'warn';
  return 'ok';
}

export function createSimulatedSource({ getContext }) {
  /* 현재값 상태 — 라인 × 선택 가능 설비 */
  const state = {};
  PRODUCTION_LINES.forEach((line) => {
    state[line.id] = {};
    SELECTABLE_ASSETS.forEach((asset) => {
      const base = TELEMETRY_BASELINES[asset.id] ?? AMBIENT;
      /* 라인·설비마다 살짝 다른 초기값에서 시작 */
      state[line.id][asset.id] = {
        temp: base.temp * (0.96 + Math.random() * 0.08),
        vib: base.vib * (0.9 + Math.random() * 0.2),
        amp: base.amp * (0.92 + Math.random() * 0.16),
      };
    });
  });

  const listeners = new Set();
  let timer = null;

  const step = () => {
    const ctx = getContext?.() ?? {};
    const { stoppedByLine = {}, faults = {} } = ctx;

    PRODUCTION_LINES.forEach((line) => {
      const stopped = Boolean(stoppedByLine[line.id]);
      /* 라인당 오류 설비 여러 개 — { lineId: assetId[] } */
      const faultedAssets = faults[line.id] ?? [];

      SELECTABLE_ASSETS.forEach((asset) => {
        const cur = state[line.id][asset.id];
        const base = TELEMETRY_BASELINES[asset.id] ?? AMBIENT;
        const faulted = faultedAssets.includes(asset.id);

        /* 상황별 수렴 목표 */
        const target = faulted
          ? { temp: base.temp + 18, vib: base.vib * 3, amp: base.amp * 1.6 }
          : stopped
            ? AMBIENT
            : base;

        /* OU 랜덤워크: 목표로 10~20% 씩 끌려가며 노이즈가 얹힌다.
           온도는 열 관성이 커서 느리게, 진동·전류는 빠르게 반응한다. */
        cur.temp += (target.temp - cur.temp) * 0.06 + (Math.random() - 0.5) * 0.5;
        cur.vib = Math.max(0, cur.vib + (target.vib - cur.vib) * 0.22 + (Math.random() - 0.5) * base.vib * 0.14);
        cur.amp = Math.max(0, cur.amp + (target.amp - cur.amp) * 0.2 + (Math.random() - 0.5) * base.amp * 0.1);
      });
    });

    /* 스냅샷 복사본으로 방출 — 구독자가 내부 상태를 오염시키지 못하게 */
    const readings = Object.fromEntries(
      PRODUCTION_LINES.map((line) => [
        line.id,
        Object.fromEntries(
          SELECTABLE_ASSETS.map((asset) => [asset.id, { ...state[line.id][asset.id] }])
        ),
      ])
    );
    const packet = {
      at: Date.now(),
      readings,
      latencyMs: 18 + Math.round(Math.random() * 14), // 게이트웨이 왕복 지연 흉내
    };
    listeners.forEach((fn) => fn(packet));
  };

  return {
    info: { id: 'sim', label: '시뮬레이션 소스', protocol: 'SIM' },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (timer) return;
      timer = setInterval(step, 1000);
      step(); // 첫 값은 즉시
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
