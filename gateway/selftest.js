/**
 * 게이트웨이 자가 검증 — 실행 중인 게이트웨이(ws://localhost:8125)에 접속해
 * 프레임을 대시보드의 "실제 파서"(src/telemetry/opcuaSource.js)로 검증한다.
 * 파서를 복제하지 않고 import 하므로, 규격이 어긋나면 여기서 바로 걸린다.
 *
 *  사용: node selftest.js [ws주소] [검증 프레임 수]
 *  종료 코드 0 = 통과, 1 = 실패
 */
import WebSocket from 'ws';
import { parseGatewayMessage } from '../src/telemetry/opcuaSource.js';
import { PRODUCTION_LINES, SELECTABLE_ASSETS } from '../src/data/factoryAssets.js';

const URL = process.argv[2] ?? 'ws://localhost:8125';
const NEED = Number(process.argv[3] ?? 3);

const ws = new WebSocket(URL);
let ok = 0;
let alarms = 0;

const fail = (why) => {
  console.error(`SELFTEST FAIL: ${why}`);
  process.exit(1);
};

const timeout = setTimeout(() => fail(`${NEED}개 유효 프레임을 15초 안에 받지 못함 (수신 ${ok})`), 15_000);

ws.on('error', (e) => fail(`접속 실패 ${URL}: ${e.message}`));
ws.on('message', (data) => {
  const parsed = parseGatewayMessage(data.toString());
  if (parsed.kind === 'invalid') fail(`파서 거부: ${parsed.reason}`);
  if (parsed.kind === 'alarm') {
    alarms += 1;
    console.log(`  알람 프레임 OK: [${parsed.alarm.code}] ${parsed.alarm.title}`);
    return;
  }
  /* telemetry — 알려진 전 라인·전 설비가 담겨 있는지까지 확인 */
  for (const line of PRODUCTION_LINES) {
    const byAsset = parsed.readings[line.id];
    if (!byAsset) fail(`라인 누락: ${line.id}`);
    for (const asset of SELECTABLE_ASSETS) {
      if (!byAsset[asset.id]) fail(`설비 누락: ${line.id}/${asset.id}`);
    }
  }
  ok += 1;
  console.log(`  telemetry 프레임 OK (${ok}/${NEED}) — latencyMs=${parsed.latencyMs}`);
  if (ok >= NEED) {
    clearTimeout(timeout);
    console.log(`SELFTEST PASS — telemetry ${ok}건 검증, 알람 ${alarms}건 수신`);
    process.exit(0);
  }
});
