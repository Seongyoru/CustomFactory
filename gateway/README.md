# EGIS OPC-UA ↔ WebSocket 게이트웨이 (참조 구현)

대시보드는 브라우저라 OPC-UA(TCP)를 직접 말할 수 없습니다. 이 게이트웨이가
사내망에서 PLC(OPC-UA 서버)를 구독해, 대시보드가 소비하는 WebSocket JSON
프레임으로 중계합니다. 프론트엔드(`src/telemetry/opcuaSource.js`)와 같은
저장소에 있어 라인·설비 ID 와 프레임 규격의 단일 소스를 유지합니다.

```
[PLC / OPC-UA 서버] ──opc.tcp──▶ [이 게이트웨이] ──ws(s)──▶ [대시보드]
```

## 빠른 시작

```bash
cd gateway
npm install
```

### 1) PLC 없이 (내장 시뮬레이터)

```bash
npm run sim          # ws://localhost:8125
```

### 2) 데모 PLC 로 전 경로 검증

```bash
npm run demo-plc     # 터미널 1 — 가짜 PLC (opc.tcp://localhost:4840/egis)
npm run opcua        # 터미널 2 — 게이트웨이가 데모 PLC 를 구독
npm run selftest     # 터미널 3 — 프레임을 대시보드의 실제 파서로 검증
```

### 3) 대시보드 연결

대시보드 하단 상태바 → 데이터 소스 → **OPC-UA 게이트웨이** →
`ws://localhost:8125` (관리자 권한). HTTPS 로 배포된 페이지에서는 `wss://` 필요
(리버스 프록시에 TLS 종단을 두면 됩니다).

## 실 PLC 적용

`tags.example.json` 을 `tags.config.json` 으로 복사하고 두 가지만 바꿉니다:

1. `endpoint` — 현장 OPC-UA 서버 주소 (`opc.tcp://…`)
2. 태그 매핑 — 주소가 규칙적이면 `nodeIdTemplate`, 불규칙하면 `tags` 배열에
   `{ lineId, assetId, metric, nodeId }` 를 명시 (혼용 가능)

지표는 설비당 `temp`(°C)·`vib`(mm/s)·`amp`(A) 3종이고, 세 값이 모두 수신된
설비만 프레임에 담습니다. 알람은 라인별 문자열 태그(JSON
`{assetId, code, title, detail}`) 관례를 쓰며 — 현장 알람 이벤트 체계가 있다면
`sources/opcuaSource.js` 의 알람 구독부를 그 체계로 교체하세요.

## 프레임 규격 (대시보드 파서와 1:1)

```jsonc
{ "type": "telemetry",
  "readings": { "L1": { "CUTTING_UNIT": { "temp": 58.1, "vib": 4.2, "amp": 12.5 } } },
  "latencyMs": 12 }

{ "type": "alarm", "lineId": "L1", "assetId": "CONVEYOR_UNIT",
  "code": "E-1123", "title": "벨트 슬립 감지", "detail": "…" }
```

상한: 프레임 256KB · 라인 32 · 라인당 설비 64 · 숫자 지표만 인정 —
초과분은 대시보드가 조용히 버립니다 (`opcuaSource.js` 참조).
