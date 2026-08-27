/**
 * OPC-UA 소스 — 실 PLC(또는 demo-opcua-server)의 태그를 구독해 최신값을 유지한다.
 *
 *  - 계측 태그: tags.config 의 매핑(nodeId ↔ 라인·설비·지표)대로 monitored item 구독.
 *    스냅샷은 세 지표(temp·vib·amp)가 전부 수신된 설비만 담는다 — 일부만 온 설비를
 *    0 으로 채워 보내면 화면에서 '식은 센서'가 실측으로 둔갑한다.
 *  - 알람 태그: 라인별 문자열 태그(JSON) 관례. 값이 바뀌고 비어 있지 않으면
 *    { assetId, code, title, detail } 로 파싱해 알람 콜백을 부른다.
 *    (실 PLC 의 알람 이벤트 체계가 있다면 이 부분을 그 체계로 교체한다)
 *  - 연결 관리는 node-opcua 의 connectionStrategy 에 맡긴다 (무한 재시도).
 */
import {
  AttributeIds,
  OPCUAClient,
  TimestampsToReturn,
} from 'node-opcua';

export async function createOpcuaSource({ config, onAlarm }) {
  const { endpoint, tags, alarmNodes } = config;

  /* 최신값 저장소 — values[lineId][assetId] = { temp, vib, amp, at } */
  const values = {};
  let lastUpdateAt = 0;

  const client = OPCUAClient.create({
    endpointMustExist: false,
    connectionStrategy: { maxRetry: -1, initialDelay: 2000, maxDelay: 15000 },
  });
  client.on('backoff', (retry, delay) =>
    console.warn(`[opcua] 연결 재시도 ${retry} — ${delay}ms 후 (${endpoint})`)
  );
  client.on('connection_lost', () => console.warn('[opcua] 연결 끊김 — 자동 재접속'));
  client.on('connection_reestablished', () => console.log('[opcua] 연결 복구'));

  await client.connect(endpoint);
  const session = await client.createSession();
  console.log(`[opcua] 세션 연결됨 — ${endpoint}`);

  const subscription = await session.createSubscription2({
    requestedPublishingInterval: 500,
    requestedLifetimeCount: 100,
    requestedMaxKeepAliveCount: 20,
    maxNotificationsPerPublish: 2000,
    publishingEnabled: true,
    priority: 10,
  });

  /* 계측 태그 구독 */
  for (const tag of tags) {
    const item = await subscription.monitor(
      { nodeId: tag.nodeId, attributeId: AttributeIds.Value },
      { samplingInterval: 500, discardOldest: true, queueSize: 1 },
      TimestampsToReturn.Neither
    );
    item.on('changed', (dataValue) => {
      const v = dataValue?.value?.value;
      if (typeof v !== 'number' || !Number.isFinite(v)) return; // 죽은 태그는 무시
      const line = (values[tag.lineId] ??= {});
      const asset = (line[tag.assetId] ??= {});
      asset[tag.metric] = v;
      lastUpdateAt = Date.now();
    });
    item.on('err', (message) => console.warn(`[opcua] 태그 구독 실패 ${tag.nodeId}: ${message}`));
  }

  /* 알람 태그 구독 — 값 변경 + 비어 있지 않을 때만 발화 (재구독 초기값 중복 방지용 이전값 추적) */
  const lastAlarmRaw = new Map();
  for (const { lineId, nodeId } of alarmNodes) {
    const item = await subscription.monitor(
      { nodeId, attributeId: AttributeIds.Value },
      { samplingInterval: 500, discardOldest: true, queueSize: 5 },
      TimestampsToReturn.Neither
    );
    item.on('changed', (dataValue) => {
      const raw = dataValue?.value?.value;
      if (typeof raw !== 'string' || raw === lastAlarmRaw.get(nodeId)) return;
      lastAlarmRaw.set(nodeId, raw);
      if (raw.trim() === '') return; // 빈 문자열 = 알람 없음
      try {
        const a = JSON.parse(raw);
        if ([a.assetId, a.code, a.title].every((s) => typeof s === 'string' && s.length > 0)) {
          onAlarm?.({
            lineId,
            assetId: a.assetId,
            code: a.code,
            title: a.title,
            detail: typeof a.detail === 'string' ? a.detail : '',
          });
        }
      } catch {
        console.warn(`[opcua] 알람 태그 JSON 파싱 실패 (${nodeId}): ${raw.slice(0, 120)}`);
      }
    });
  }

  console.log(`[opcua] 계측 태그 ${tags.length}개 · 알람 태그 ${alarmNodes.length}개 구독 완료`);

  return {
    snapshot() {
      const readings = {};
      for (const [lineId, byAsset] of Object.entries(values)) {
        for (const [assetId, m] of Object.entries(byAsset)) {
          if (['temp', 'vib', 'amp'].every((k) => Number.isFinite(m[k]))) {
            (readings[lineId] ??= {})[assetId] = { temp: m.temp, vib: m.vib, amp: m.amp };
          }
        }
      }
      return { readings, ageMs: lastUpdateAt > 0 ? Date.now() - lastUpdateAt : 0 };
    },
  };
}
