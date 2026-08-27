/**
 * =============================================================================
 *  데모 OPC-UA 서버 — 실 PLC 가 없는 환경에서 게이트웨이의 OPC-UA 경로를
 *  끝까지 검증하기 위한 가짜 PLC
 * =============================================================================
 *  tags.example.json 의 관례(ns=1;s={라인}.{설비}.{지표}, {라인}.ALARM)대로
 *  태그를 노출하고, 1초마다 기준값 주변에서 값이 살아 움직인다.
 *  90초마다 무작위 라인의 알람 태그에 FAULT_SCENARIOS 1건을 30초간 올린다.
 *
 *  실행: npm run demo-plc  →  opc.tcp://localhost:4840/egis
 * ---------------------------------------------------------------------------
 */
import { DataType, OPCUAServer, Variant } from 'node-opcua';
import { FAULT_SCENARIOS, PRODUCTION_LINES, SELECTABLE_ASSETS } from '../src/data/factoryAssets.js';
import { TELEMETRY_BASELINES } from '../src/telemetry/simulatedSource.js';

const METRICS = ['temp', 'vib', 'amp'];

const server = new OPCUAServer({
  port: 4840,
  resourcePath: '/egis',
  buildInfo: { productName: 'EGIS-DemoPLC', buildNumber: '1' },
});
await server.initialize();

const addressSpace = server.engine.addressSpace;
const namespace = addressSpace.getOwnNamespace();
const root = namespace.addObject({
  organizedBy: addressSpace.rootFolder.objects,
  browseName: 'EgisLines',
});

/* 계측값 상태 + 태그 노출 */
const state = {};
const alarmValues = {};
for (const line of PRODUCTION_LINES) {
  state[line.id] = {};
  for (const asset of SELECTABLE_ASSETS) {
    const base = TELEMETRY_BASELINES[asset.id] ?? { temp: 40, vib: 2, amp: 6 };
    state[line.id][asset.id] = { ...base };
    for (const metric of METRICS) {
      namespace.addVariable({
        componentOf: root,
        browseName: `${line.id}.${asset.id}.${metric}`,
        nodeId: `ns=1;s=${line.id}.${asset.id}.${metric}`,
        dataType: 'Double',
        minimumSamplingInterval: 200,
        value: {
          get: () => new Variant({ dataType: DataType.Double, value: state[line.id][asset.id][metric] }),
        },
      });
    }
  }
  alarmValues[line.id] = '';
  namespace.addVariable({
    componentOf: root,
    browseName: `${line.id}.ALARM`,
    nodeId: `ns=1;s=${line.id}.ALARM`,
    dataType: 'String',
    minimumSamplingInterval: 200,
    value: { get: () => new Variant({ dataType: DataType.String, value: alarmValues[line.id] }) },
  });
}

/* 값이 살아 움직인다 — 기준값 수렴 랜덤워크 */
setInterval(() => {
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

/* 90초마다 알람 1건 (30초 뒤 자동 해제) — 게이트웨이의 알람 경로 검증용 */
setInterval(() => {
  const line = PRODUCTION_LINES[Math.floor(Math.random() * PRODUCTION_LINES.length)];
  const sc = FAULT_SCENARIOS[Math.floor(Math.random() * FAULT_SCENARIOS.length)];
  alarmValues[line.id] = JSON.stringify({
    assetId: sc.assetId,
    code: sc.code,
    title: sc.title,
    detail: sc.detail,
  });
  console.log(`[demo-plc] 알람 세트: ${line.id} [${sc.code}] ${sc.title}`);
  setTimeout(() => {
    alarmValues[line.id] = '';
  }, 30_000);
}, 90_000);

await server.start();
console.log('[demo-plc] OPC-UA 서버 가동 — opc.tcp://localhost:4840/egis');
console.log(`[demo-plc] 계측 태그 ${PRODUCTION_LINES.length * SELECTABLE_ASSETS.length * METRICS.length}개 · 알람 태그 ${PRODUCTION_LINES.length}개`);
