/**
 * =============================================================================
 *  라인별 설비 인스턴스 마스터
 * =============================================================================
 *  FACTORY_ASSETS 는 설비 '형식(모델)' 마스터이자 1호기(L1) 실물 값입니다.
 *  같은 모델이라도 호기마다 시리얼·설치일·점검 이력·소모품 잔량이 다르므로,
 *  라인별로 다른 값만 여기에 오버라이드합니다. (형식 공통 값 — 모델명·제조사·
 *  공정 역할·GLB 파일·오프셋 — 은 FACTORY_ASSETS 한 곳만 봅니다)
 *
 *  2호기(L2)는 2025-01 증설분입니다 — 전 설비가 신품이라 소모품 잔량이 높고
 *  이력이 짧습니다. 1호기 절단기의 톱날 임박(10%) 경고가 2호기에는 없어서,
 *  라인을 전환하면 상세 패널·소모품 리스크 예측이 실제로 달라지는 것이
 *  눈에 보입니다.
 *
 *  실서버 연동 시 이 오버라이드 테이블을 설비 마스터 API 응답으로 교체하면
 *  됩니다 — findLineAsset() 의 병합 규칙(형식 ← 인스턴스)은 그대로 유효합니다.
 * ---------------------------------------------------------------------------
 */
import { SELECTABLE_ASSETS, findAsset } from './factoryAssets.js';

export const LINE_ASSET_OVERRIDES = {
  /* 1호기 — FACTORY_ASSETS 원본 값이 곧 L1 실물 데이터 */
  L1: {},

  /* 2호기 — 2025-01 증설 (신품) */
  L2: {
    CUTTING_UNIT: {
      sn: 'Z4T6C5G2P8R1B7',
      mfgDate: '2024.11',
      installedAt: '2025-01-14',
      lastCheck: '2026-07-20',
      nextCheck: '2026-10-20',
      status: 'RUNNING',
      statusMessage: '정상 절단 중',
      consumable: { label: '톱날 잔여', percent: 68 },
      history: [
        { date: '2026-07-20', type: '정기점검', note: '톱날 마모율 32%, 이상 없음' },
        { date: '2025-01-14', type: '설치검수', note: '증설 시운전 합격 (절단 정도 ±0.3mm)' },
      ],
    },
    CONVEYOR_UNIT: {
      sn: 'CV-1200-2024-02051',
      mfgDate: '2024.10',
      installedAt: '2025-01-14',
      lastCheck: '2026-06-28',
      nextCheck: '2026-09-28',
      status: 'RUNNING',
      statusMessage: '정상 이송 중',
      consumable: { label: '벨트 수명', percent: 91 },
      history: [
        { date: '2026-06-28', type: '정기점검', note: '벨트 사행 보정, 장력 규격 내' },
        { date: '2025-01-14', type: '설치검수', note: '증설 라인 반입·수평 정렬 완료' },
      ],
    },
    CART_UNIT: {
      sn: 'CRT-1600-2024-00112',
      mfgDate: '2024.12',
      installedAt: '2025-01-20',
      lastCheck: '2026-07-05',
      nextCheck: '2026-10-05',
      status: 'RUNNING',
      statusMessage: '실린더 충전 중',
      consumable: { label: '배터리', percent: 87 },
      history: [
        { date: '2026-07-05', type: '정기점검', note: '배터리 셀 밸런스 정상' },
        { date: '2025-01-20', type: '설치검수', note: 'AGV 유도 라인 티칭 완료' },
      ],
    },
    LOAD_TRANSFER_ROBOT: {
      sn: 'LTR-2400-2024-00893',
      mfgDate: '2024.09',
      installedAt: '2025-01-16',
      lastCheck: '2026-07-15',
      nextCheck: '2026-10-15',
      status: 'RUNNING',
      statusMessage: '이재 동작 중',
      consumable: { label: '감속기 수명', percent: 95 },
      history: [
        { date: '2026-07-15', type: '정기점검', note: '전 축 백래시 규격 내, 그리스 보충' },
        { date: '2025-01-16', type: '설치검수', note: '티칭 포인트 12점 등록' },
      ],
    },
    POLY_ROBOT: {
      sn: 'PLR-0900-2024-00411',
      mfgDate: '2024.10',
      installedAt: '2025-01-18',
      lastCheck: '2026-06-25',
      nextCheck: '2026-09-25',
      status: 'IDLE',
      statusMessage: '충전 지시 대기',
      consumable: { label: '툴 체인저', percent: 98 },
      history: [
        { date: '2026-06-25', type: '정기점검', note: 'TCP 편차 0.1mm, 재교정 불요' },
        { date: '2025-01-18', type: '설치검수', note: '충전 노즐 툴 결합 시험 합격' },
      ],
    },
    POPUP_UNIT: {
      sn: 'PUU-2300-2024-00159',
      mfgDate: '2024.11',
      installedAt: '2025-01-20',
      lastCheck: '2026-07-10',
      nextCheck: '2026-10-10',
      status: 'RUNNING',
      statusMessage: '승강 동작 정상',
      consumable: { label: '실린더 패킹', percent: 96 },
      history: [
        { date: '2026-07-10', type: '정기점검', note: '승강 스트로크·평행도 규격 내' },
        { date: '2025-01-20', type: '설치검수', note: '카트 위치 결정 반복 정도 시험 합격' },
      ],
    },
  },
};

/**
 * 라인의 설비 인스턴스 — 형식 마스터에 라인 오버라이드를 병합해 돌려준다.
 *  모르는 라인이면 형식 값 그대로(안전한 폴백), 모르는 설비면 null.
 *  돌려주는 객체에 lineId 가 박혀 있어 "어느 호기인가"를 항상 알 수 있다.
 */
export const findLineAsset = (lineId, assetId) => {
  const base = findAsset(assetId);
  if (!base) return null;
  const inst = LINE_ASSET_OVERRIDES[lineId]?.[assetId];
  return { ...base, ...inst, lineId };
};

/** 라인의 선택 가능 설비 전체 (인스턴스 병합본) — 소모품 리스크 예측 등에 쓴다 */
export const lineSelectableAssets = (lineId) =>
  SELECTABLE_ASSETS.map((a) => findLineAsset(lineId, a.id));

/** 설비 메모 저장 키 — 메모는 형식이 아니라 호기(라인×설비)에 붙는 기록이다 */
export const memoKeyOf = (lineId, assetId) => `${lineId}:${assetId}`;
