/**
 * =============================================================================
 *  EGIS OPC-UA ↔ WebSocket 게이트웨이 (참조 구현)
 * =============================================================================
 *  대시보드(src/telemetry/opcuaSource.js)가 소비하는 프레임 규격으로 계측·알람을
 *  중계한다. 프론트엔드와 같은 저장소에 두는 이유: 라인·설비 ID 와 프레임 규격의
 *  단일 소스를 유지하기 위해서다 (../src 의 데이터 정의를 그대로 import 한다).
 *
 *  [ 송신 프레임 — opcuaSource.js 의 파서와 1:1 ]
 *   { "type": "telemetry", "readings": { 라인: { 설비: { temp, vib, amp } } }, "latencyMs": n }
 *   { "type": "alarm", "lineId", "assetId", "code", "title", "detail" }
 *
 *  [ 실행 ]
 *   npm run sim                       — 내장 시뮬레이터로 즉시 송출 (PLC 불필요)
 *   npm run opcua                     — tags.config.json(없으면 example)의 OPC-UA 서버 구독
 *   node server.js --port 8125 --interval 1000 --source opcua --config ./tags.config.json
 *
 *  실 PLC 적용 시 바꿀 것은 tags.config.json 하나다 — endpoint 와
 *  태그 주소(nodeId) ↔ 라인·설비·지표 매핑. 코드는 그대로 둔다.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { createSimSource } from './sources/simSource.js';
import { createOpcuaSource } from './sources/opcuaSource.js';

const here = dirname(fileURLToPath(import.meta.url));

/* ---- CLI 인자 ---- */
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', 8125));
const INTERVAL_MS = Math.max(200, Number(arg('interval', 1000)));
const SOURCE = arg('source', 'sim');
const CONFIG_PATH = resolve(
  here,
  arg('config', existsSync(resolve(here, 'tags.config.json')) ? 'tags.config.json' : 'tags.example.json')
);

/* ---- 태그 설정 로드 (opcua 소스용 — sim 은 설정 없이 동작) ---- */
const loadConfig = () => {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  /* nodeIdTemplate 방식과 명시 tags 배열 방식을 모두 지원한다 — 데모는 템플릿,
     실 PLC 는 태그 주소가 불규칙하므로 명시 배열로 옮겨 적으면 된다 */
  const tags = [...(raw.tags ?? [])];
  if (raw.nodeIdTemplate && raw.lines && raw.assets && raw.metrics) {
    for (const lineId of raw.lines) {
      for (const assetId of raw.assets) {
        for (const metric of raw.metrics) {
          tags.push({
            lineId,
            assetId,
            metric,
            nodeId: raw.nodeIdTemplate
              .replaceAll('{lineId}', lineId)
              .replaceAll('{assetId}', assetId)
              .replaceAll('{metric}', metric),
          });
        }
      }
    }
  }
  const alarmNodes = [];
  if (raw.alarmNodeTemplate && raw.lines) {
    for (const lineId of raw.lines) {
      alarmNodes.push({ lineId, nodeId: raw.alarmNodeTemplate.replaceAll('{lineId}', lineId) });
    }
  }
  alarmNodes.push(...(raw.alarmNodes ?? []));
  return { endpoint: raw.endpoint, tags, alarmNodes };
};

/* ---- WebSocket 서버 ---- */
const wss = new WebSocketServer({ port: PORT });
const broadcast = (obj) => {
  const text = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) client.send(text);
  }
};

/* ---- 소스 기동 ---- */
const onAlarm = (alarm) => {
  broadcast({ type: 'alarm', ...alarm });
  console.log(`[alarm] ${alarm.lineId}/${alarm.assetId} [${alarm.code}] ${alarm.title}`);
};

let source;
if (SOURCE === 'opcua') {
  const config = loadConfig();
  console.log(`[gateway] OPC-UA 소스 — ${config.endpoint} · 태그 ${config.tags.length}개 (${CONFIG_PATH})`);
  source = await createOpcuaSource({ config, onAlarm });
} else {
  console.log('[gateway] 시뮬레이터 소스 — PLC 없이 데모 계측을 생성합니다');
  source = createSimSource({ onAlarm });
}

/* 1초마다 스냅샷 프레임 브로드캐스트. latencyMs = 계측 나이(마지막 갱신 후 경과) */
setInterval(() => {
  const { readings, ageMs } = source.snapshot();
  if (Object.keys(readings).length === 0) return; // 아직 첫 계측 전 — 침묵이 정직하다
  broadcast({ type: 'telemetry', readings, latencyMs: Math.round(ageMs) });
}, INTERVAL_MS);

wss.on('connection', (client, req) => {
  console.log(`[gateway] 클라이언트 접속: ${req.socket.remoteAddress} (총 ${wss.clients.size})`);
  /* 접속 즉시 현재 스냅샷을 한 번 밀어준다 — 첫 프레임까지 최대 1초를 기다리지 않게 */
  const { readings, ageMs } = source.snapshot();
  if (Object.keys(readings).length > 0 && client.readyState === 1) {
    client.send(JSON.stringify({ type: 'telemetry', readings, latencyMs: Math.round(ageMs) }));
  }
});

console.log(`[gateway] ws://localhost:${PORT} 대기 중 — 대시보드 '데이터 소스 설정'에 이 주소를 넣으세요`);
