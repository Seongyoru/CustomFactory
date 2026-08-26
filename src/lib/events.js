/**
 * =============================================================================
 *  운영 이벤트 로그 — 알람/정지/작업/조작 이력의 단일 형식
 * =============================================================================
 *  모든 이벤트는 { id, at(ISO), type, message, lineId?, assetId?, user?, meta? }
 *  형태다. 실제 MES/OPC-UA 연동 시 서버 이벤트를 같은 형태로 밀어 넣으면
 *  리포트·감사 로그 화면이 그대로 동작한다.
 * ---------------------------------------------------------------------------
 */

export const EVENT_TYPES = {
  ALARM_RAISED: { label: '설비 오류 발생', tone: 'red' },
  ALARM_ACKED: { label: '알람 확인', tone: 'amber' },
  ALARM_CLEARED: { label: '알람 해제', tone: 'emerald' },
  ESTOP_ON: { label: '비상 정지', tone: 'red' },
  ESTOP_OFF: { label: '비상 정지 해제', tone: 'emerald' },
  JOB_ADDED: { label: '로트 추가', tone: 'sky' },
  JOB_IMPORTED: { label: '엑셀 업로드', tone: 'sky' },
  JOB_CANCELLED: { label: '로트 취소', tone: 'amber' },
  JOB_REORDERED: { label: '생산 순서 변경', tone: 'sky' },
  JOB_COMPLETED: { label: '로트 완료', tone: 'emerald' },
  LAYOUT_MOVED: { label: '설비 배치 변경', tone: 'slate' },
  MEMO_ADDED: { label: '작업자 메모', tone: 'slate' },
  CONSUMABLE_LOW: { label: '소모품 잔량 경고', tone: 'amber' },
  MAINT_REPLACED: { label: '소모품 교체', tone: 'emerald' },
  LOGIN: { label: '로그인', tone: 'sky' },
  LOGOUT: { label: '로그아웃', tone: 'slate' },
  DATA_RESET: { label: '데이터 초기화', tone: 'amber' },
  SIM_SNAPSHOT: { label: '시뮬레이션 저장', tone: 'sky' },
  SIM_SNAPSHOT_DELETED: { label: '시뮬레이션 스냅샷 삭제', tone: 'amber' },
  SOURCE_CHANGED: { label: '데이터 소스 변경', tone: 'sky' },
};

export const eventLabel = (type) => EVENT_TYPES[type]?.label ?? type;

let seq = 0;
export const makeEvent = (type, message, extra = {}) => ({
  id: `EV-${Date.now()}-${(seq = (seq + 1) % 1000)}`,
  at: new Date().toISOString(),
  type,
  message,
  ...extra,
});

/** 이벤트 로그 최대 보관 건수 — localStorage 이므로 무한히 쌓지 않는다 */
export const EVENT_LOG_LIMIT = 800;
