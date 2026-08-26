/**
 * =============================================================================
 *  OPC-UA 게이트웨이 어댑터 (WebSocket) — 실설비 연동의 진입점
 * =============================================================================
 *  브라우저는 OPC-UA(TCP)를 직접 말할 수 없다. 사내망에 아래 프로토콜로 중계하는
 *  게이트웨이(OPC-UA 클라이언트 ↔ WebSocket 서버)를 두면, 이 어댑터가
 *  simulatedSource 와 동일한 소스 인터페이스로 화면에 실계측을 흘린다 —
 *  화면 코드는 한 줄도 바뀌지 않는다.
 *
 *  [ 게이트웨이 → 클라이언트 메시지 (JSON 텍스트 프레임) ]
 *   계측:
 *    { "type": "telemetry",
 *      "readings": { "<lineId>": { "<assetId>": { "temp": n, "vib": n, "amp": n } } },
 *      "latencyMs": n? }
 *   알람 (FAULT_SCENARIOS 와 같은 형태 — 기존 알람 팝업·하이라이트가 그대로 동작):
 *    { "type": "alarm", "lineId": "L1", "assetId": "CONVEYOR_UNIT",
 *      "code": "E-1123", "title": "...", "detail": "..." }
 *
 *  연결이 끊기면 지수 백오프(2s→4→8→16, 최대 15s)로 재접속한다.
 *  ※ HTTPS 로 배포된 페이지에서는 wss:// 만 허용된다 (혼합 콘텐츠 차단).
 * ---------------------------------------------------------------------------
 */

/* 프레임/필드 상한 — 오작동·악성 게이트웨이가 화면을 멈추거나 메모리를 태우지 않게 */
export const MAX_FRAME_BYTES = 256 * 1024;
export const MAX_LINES_PER_FRAME = 32;
export const MAX_ASSETS_PER_LINE = 64;
export const MAX_ALARM_TITLE_LEN = 200;
export const MAX_ALARM_DETAIL_LEN = 2000;

/* null·''·true 는 Number() 로 0/1 이 되어 죽은 센서가 실측 0 으로 둔갑한다 — 숫자 타입만 인정 */
const strictNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/** 게이트웨이 메시지 파싱/검증 — 순수 함수 (테스트 대상) */
export const parseGatewayMessage = (raw) => {
  if (typeof raw !== 'string') return { kind: 'invalid', reason: '텍스트 프레임이 아님' };
  if (raw.length > MAX_FRAME_BYTES) return { kind: 'invalid', reason: '프레임 크기 초과' };
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', reason: 'JSON 파싱 실패' };
  }
  if (!msg || typeof msg !== 'object') return { kind: 'invalid', reason: '객체가 아님' };

  if (msg.type === 'telemetry') {
    if (!msg.readings || typeof msg.readings !== 'object') {
      return { kind: 'invalid', reason: 'readings 없음' };
    }
    /* 숫자가 아닌 계측값은 설비 단위로 버린다 — 일부가 깨져도 나머지는 살린다 */
    const readings = {};
    let lineCount = 0;
    for (const [lineId, byAsset] of Object.entries(msg.readings)) {
      if (lineCount >= MAX_LINES_PER_FRAME) break;
      if (!byAsset || typeof byAsset !== 'object') continue;
      const line = {};
      let assetCount = 0;
      for (const [assetId, m] of Object.entries(byAsset)) {
        if (assetCount >= MAX_ASSETS_PER_LINE) break;
        assetCount += 1;
        if (!m || typeof m !== 'object') continue;
        const temp = strictNum(m.temp);
        const vib = strictNum(m.vib);
        const amp = strictNum(m.amp);
        if ([temp, vib, amp].every(Number.isFinite)) line[assetId] = { temp, vib, amp };
      }
      if (Object.keys(line).length > 0) {
        readings[lineId] = line;
        lineCount += 1;
      }
    }
    if (Object.keys(readings).length === 0) {
      return { kind: 'invalid', reason: '유효한 계측값 없음' };
    }
    const latencyMs = strictNum(msg.latencyMs);
    return { kind: 'telemetry', readings, latencyMs: Number.isFinite(latencyMs) ? latencyMs : null };
  }

  if (msg.type === 'alarm') {
    const { lineId, assetId, code, title, detail } = msg;
    if (![lineId, assetId, code, title].every((v) => typeof v === 'string' && v.length > 0)) {
      return { kind: 'invalid', reason: '알람 필수 필드 누락 (lineId·assetId·code·title)' };
    }
    return {
      kind: 'alarm',
      alarm: {
        lineId,
        assetId,
        code,
        title: title.slice(0, MAX_ALARM_TITLE_LEN),
        detail: typeof detail === 'string' ? detail.slice(0, MAX_ALARM_DETAIL_LEN) : '',
      },
    };
  }

  return { kind: 'invalid', reason: `알 수 없는 type: ${String(msg.type)}` };
};

/** 재접속 대기 시간 (ms) — 지수 백오프, 상한 15초 */
export const retryDelayMs = (attempt) => Math.min(15000, 1000 * 2 ** Math.min(4, Math.max(1, attempt)));

export function createOpcUaSource({ url, onStatus, onAlarm }) {
  const listeners = new Set();
  let ws = null;
  let closedByUs = false;
  let retryCount = 0;
  let retryTimer = null;

  const setStatus = (status, detail) => onStatus?.(status, detail);

  const scheduleRetry = () => {
    if (closedByUs) return;
    retryCount += 1;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, retryDelayMs(retryCount));
  };

  const connect = () => {
    if (closedByUs) return;
    setStatus(retryCount === 0 ? 'connecting' : 'reconnecting');
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      /* URL 자체가 잘못된 경우 등 — 생성부터 실패 */
      setStatus('error', String(e?.message ?? e));
      scheduleRetry();
      return;
    }
    ws = socket;
    /* 각 핸들러는 자기 소켓이 아직 현역(socket === ws)일 때만 동작한다 —
       stop()/재접속으로 버려진 소켓의 늦은 이벤트가 현재 상태를 건드리지 못하게 */
    socket.onopen = () => {
      if (socket !== ws) return;
      setStatus('connected');
    };
    socket.onmessage = (ev) => {
      if (socket !== ws) return;
      const parsed = parseGatewayMessage(ev.data);
      if (parsed.kind === 'telemetry') {
        /* 백오프 리셋은 open 이 아니라 유효 프레임 기준 — 핸드셰이크만 받고
           바로 끊는 게이트웨이에 2초 간격으로 영원히 재접속하지 않게 */
        retryCount = 0;
        const packet = { at: Date.now(), readings: parsed.readings, latencyMs: parsed.latencyMs ?? 0 };
        listeners.forEach((fn) => fn(packet));
      } else if (parsed.kind === 'alarm') {
        retryCount = 0;
        onAlarm?.(parsed.alarm);
      }
      /* invalid 프레임은 조용히 버린다 — 게이트웨이 잡음에 화면이 죽지 않게 */
    };
    socket.onerror = () => {
      /* 상세는 onclose 에서 이어진다 */
    };
    socket.onclose = () => {
      if (socket !== ws) return;
      ws = null;
      if (!closedByUs) {
        setStatus('reconnecting');
        scheduleRetry();
      }
    };
  };

  return {
    info: { id: 'opcua', label: 'OPC-UA 게이트웨이', protocol: 'OPC-UA' },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      closedByUs = false;
      retryCount = 0;
      connect();
    },
    stop() {
      closedByUs = true;
      clearTimeout(retryTimer);
      const socket = ws;
      ws = null;
      if (socket) {
        /* 이미 큐에 올라온 늦은 open/message 이벤트가 stop 이후에 실행되지 않게 떼어낸다 */
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        try {
          socket.close();
        } catch {
          /* 이미 닫힘 */
        }
      }
    },
  };
}
