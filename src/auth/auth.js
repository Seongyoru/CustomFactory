/**
 * =============================================================================
 *  계정 / 역할 / 권한 정의 — 데모용 로컬 인증
 * =============================================================================
 *  상용 배포 시 이 파일의 USERS 를 서버 인증(SSO/LDAP 등)으로 교체한다.
 *  화면 코드는 전부 hasPermission(role, perm) 만 보므로 인증 방식이 바뀌어도
 *  권한 게이트는 그대로 동작한다.
 *
 *  [ 권한 설계 ]
 *   - E-STOP '작동'은 누구나 할 수 있다 — 비상 정지는 막는 쪽이 위험하다.
 *   - E-STOP '해제'는 운영자 이상 — 안전 확인 책임이 있는 사람만 되돌린다.
 *   - 설비 배치 조정·데이터 초기화는 관리자 전용.
 * ---------------------------------------------------------------------------
 */

export const ROLES = {
  admin: { label: '시스템 관리자', tone: 'red' },
  operator: { label: '라인 운영자', tone: 'sky' },
  viewer: { label: '모니터링 전용', tone: 'slate' },
};

const ROLE_PERMISSIONS = {
  viewer: ['estop.engage'],
  operator: [
    'estop.engage',
    'estop.release',
    'jobs.manage',
    'memo.write',
    'fault.test',
    'report.export',
  ],
  admin: [
    'estop.engage',
    'estop.release',
    'jobs.manage',
    'memo.write',
    'fault.test',
    'report.export',
    'layout.adjust',
    'data.reset',
  ],
};

export const hasPermission = (role, perm) =>
  (ROLE_PERMISSIONS[role] ?? []).includes(perm);

/** 권한 없음 안내 문구 — disabled 버튼 title 로 쓴다 */
export const PERMISSION_HINTS = {
  'jobs.manage': '작업 관리는 라인 운영자 이상만 가능합니다.',
  'estop.release': '비상 정지 해제는 라인 운영자 이상만 가능합니다.',
  'layout.adjust': '설비 배치 조정은 시스템 관리자만 가능합니다.',
  'memo.write': '메모 작성은 라인 운영자 이상만 가능합니다.',
  'fault.test': '오류 테스트는 라인 운영자 이상만 가능합니다.',
  'report.export': '리포트 내보내기는 라인 운영자 이상만 가능합니다.',
  'data.reset': '데이터 초기화는 시스템 관리자만 가능합니다.',
};

/**
 * 데모 계정. PIN 은 화면에 함께 표기된다 — 시연용이지 보안 장치가 아니다.
 */
export const USERS = [
  { id: 'admin', name: '백성열', role: 'admin', pin: '0000' },
  { id: 'operator', name: '김현수', role: 'operator', pin: '1111' },
  { id: 'viewer', name: '게스트', role: 'viewer', pin: '2222' },
];

export const findUser = (id) => USERS.find((u) => u.id === id) ?? null;
