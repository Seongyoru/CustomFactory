/**
 * =============================================================================
 *  설비 마스터 데이터 (3D 씬 ↔ 우측 상세 패널 공용)
 * =============================================================================
 *  공정 개요 — HPG 라인
 *    HPG 원자재의 포장을 뜯고(Cutting) → 이송하여(Conveyor) →
 *    카트(Cart)에 실린 실린더에 충전하는 공정.
 *
 *  좌표계 / 배치 원칙:
 *   - GLB 는 CAD(Autodesk ATF) 익스포트이며 업축(Y-up) 변환이 내장돼 있습니다.
 *     추가 회전을 걸면 안 됩니다.
 *   - 각 GLB 에는 조립 상태의 상대 좌표가 그대로 구워져 있습니다.
 *     (측정값: FENCE_UNIT 이 원점 기준 4.46 × 3.20 × 6.91m 셀이고
 *      나머지 설비가 X -2.23~2.23 / Z -3.45~3.45 안에 정확히 안착)
 *     → 따라서 중심정렬·바닥안착을 하지 않고 원본 좌표 그대로 로드해야
 *       조립된 형태가 됩니다. offset 은 그 위에 더해지는 사용자 조정값입니다.
 *   - 단위는 미터. 건물(INTERIOR) 내부: X ±11.1, Z ±26.2, 층고 9.4m
 * ---------------------------------------------------------------------------
 */

/* 설비 상태 정의 ---------------------------------------------------------- */
export const STATUS = {
  RUNNING: { label: '작업 중', dot: 'bg-emerald-500', text: 'text-emerald-500', ring: 'ring-emerald-500/40', hex: '#10b981', pulse: true },
  IDLE: { label: '대기', dot: 'bg-slate-400', text: 'text-slate-400', ring: 'ring-slate-400/30', hex: '#94a3b8', pulse: false },
  WARN: { label: '주의', dot: 'bg-amber-400', text: 'text-amber-500', ring: 'ring-amber-400/40', hex: '#fbbf24', pulse: true },
  ERROR: { label: '오류', dot: 'bg-red-500', text: 'text-red-500', ring: 'ring-red-500/40', hex: '#ef4444', pulse: true },
  MAINT: { label: '점검 중', dot: 'bg-sky-500', text: 'text-sky-500', ring: 'ring-sky-500/40', hex: '#0ea5e9', pulse: false },
};

/**
 * 공장 건물 셸 — 배경 지오메트리, 선택 대상 아님
 *
 * 바닥 높이 보정:
 *  INTERIOR 는 벽·바닥·천장이 하나로 합쳐진 단일 메시라 바운딩 박스로는
 *  바닥면을 알 수 없습니다. 삼각형 중 '위를 향한 수평면'만 골라 높이별 면적을
 *  집계한 결과, Y=0.500m 에 1093m² (전체 바닥 면적)가 몰려 있었습니다.
 *  즉 실제 바닥 상면이 0.5m 에 있어, Y=0 에 놓인 설비가 그만큼 잠겨 보였습니다.
 *  셸을 -0.5m 내려 바닥 상면을 그리드(Y=0)에 일치시킵니다.
 */
export const FLOOR_TOP_Y = 0.5;
export const SHELL_ASSET = {
  id: 'INTERIOR',
  file: '/models/INTERIOR.glb',
  offset: [0, -FLOOR_TOP_Y, 0],
};

/**
 * 씬에 로드되는 설비.
 *  selectable:false → 클릭 픽킹 대상에서 제외.
 *    FENCE_UNIT 은 다른 설비를 감싸고 있어 클릭을 가로채므로 반드시 제외.
 *    DOPANT_BRIDGE / DISPENSER 도 상세 조회 대상이 아니라 제외.
 *  offset → 조립 좌표에 더해지는 배치 보정값 (사이드바에서 실시간 조정 가능)
 */
export const FACTORY_ASSETS = [
  {
    id: 'CUTTING_UNIT',
    file: '/models/CUTTING_UNIT.glb',
    selectable: true,
    offset: [0, 0, 0],
    name: 'Cutting Unit',
    nameKo: '개포장 절단기',
    role: 'HPG 원자재 포장 절단',
    sn: 'Z2R8C5G1N6Q7A3',
    maker: '동양에스텍',
    mfgDate: '2020.02',
    model: 'DYS-CUT-450',
    installedAt: '2020-04-18',
    lastCheck: '2026-07-02',
    nextCheck: '2026-10-02',
    cycleSec: 42.7,
    status: 'WARN',
    statusMessage: '톱날 교체시기 임박',
    consumable: { label: '톱날 잔여', percent: 10 },
    history: [
      { date: '2026-07-02', type: '정기점검', note: '톱날 마모율 90% 확인, 교체 예정' },
      { date: '2026-04-18', type: '수리', note: '이송 클램프 실린더 교체' },
      { date: '2026-01-09', type: '정기점검', note: '이상 없음' },
    ],
  },
  {
    id: 'CONVEYOR_UNIT',
    file: '/models/CONVEYOR_UNIT.glb',
    selectable: true,
    offset: [0, 0, 0],
    name: 'Conveyor Unit',
    nameKo: '원자재 이송 컨베이어',
    role: '절단된 HPG 원자재 이송',
    sn: 'CV-1200-2019-01187',
    maker: '한독시스템',
    mfgDate: '2019.08',
    model: 'HDC-1200L',
    installedAt: '2019-08-27',
    lastCheck: '2026-06-15',
    nextCheck: '2026-09-15',
    cycleSec: 11.2,
    status: 'RUNNING',
    statusMessage: '정상 이송 중',
    consumable: { label: '벨트 수명', percent: 72 },
    history: [
      { date: '2026-06-15', type: '정기점검', note: '벨트 장력 재조정' },
      { date: '2026-02-03', type: '수리', note: '구동 모터 베어링 교체' },
    ],
  },
  {
    id: 'CART_UNIT',
    file: '/models/CART_UNIT.glb',
    selectable: true,
    /* 카트는 이동체이므로 셀 밖 대기 위치에 주차 (조립 좌표 + 오프셋) */
    offset: [4.2, 0, 1.5],
    name: 'Cart Unit',
    nameKo: '실린더 충전 카트',
    role: 'HPG 충전 실린더 적재/이송',
    sn: 'CRT-1600-2023-00074',
    maker: '대성로보틱스',
    mfgDate: '2023.03',
    model: 'DSR-CART-16',
    installedAt: '2023-05-02',
    lastCheck: '2026-06-30',
    nextCheck: '2026-09-30',
    cycleSec: 120.0,
    status: 'RUNNING',
    statusMessage: '실린더 충전 중 (3/8)',
    consumable: { label: '배터리', percent: 61 },
    history: [
      { date: '2026-06-30', type: '정기점검', note: '주행 휠 마모 점검' },
      { date: '2026-01-17', type: '수리', note: 'AGV 센서 재교정' },
    ],
  },

  {
    id: 'LOAD_TRANSFER_ROBOT',
    file: '/models/LOAD_TRANSFER_ROBOT.glb',
    selectable: true,
    offset: [0, 0, 0],
    name: 'Load Transfer Robot',
    nameKo: '원자재 이재 로봇',
    role: '개포장된 HPG 원자재 파지 및 이송',
    sn: 'LTR-2400-2022-00516',
    maker: '현대로보틱스',
    mfgDate: '2022.06',
    model: 'HH020-A',
    installedAt: '2022-08-19',
    lastCheck: '2026-07-08',
    nextCheck: '2026-10-08',
    cycleSec: 18.4,
    status: 'RUNNING',
    statusMessage: '이재 동작 중 (5/12)',
    consumable: { label: '감속기 수명', percent: 78 },
    history: [
      { date: '2026-07-08', type: '정기점검', note: 'J2·J3축 백래시 측정, 규격 내' },
      { date: '2026-03-14', type: '수리', note: '그리퍼 진공 패드 교체' },
    ],
  },
  {
    id: 'POLY_ROBOT',
    file: '/models/POLY_ROBOT.glb',
    selectable: true,
    offset: [0, 0, 0],
    name: 'Poly Robot',
    nameKo: '실린더 충전 로봇',
    role: '카트 실린더에 HPG 원자재 충전',
    sn: 'PLR-0900-2023-00248',
    maker: '두산로보틱스',
    mfgDate: '2023.09',
    model: 'M0609',
    installedAt: '2023-11-07',
    lastCheck: '2026-06-21',
    nextCheck: '2026-09-21',
    cycleSec: 24.9,
    status: 'IDLE',
    statusMessage: '충전 지시 대기',
    consumable: { label: '툴 체인저', percent: 92 },
    history: [
      { date: '2026-06-21', type: '정기점검', note: 'TCP 재교정 완료' },
    ],
  },

  /* ---- 아래 3종은 배경/구조물이라 클릭 선택에서 제외 ---- */
  { id: 'DOPANT_BRIDGE', file: '/models/DOPANT_BRIDGE.glb', selectable: false, offset: [0, 0, 0], name: 'Dopant Bridge' },
  { id: 'DISPENSER', file: '/models/DISPENSER.glb', selectable: false, offset: [0, 0, 0], name: 'Dispenser' },
  { id: 'FENCE_UNIT', file: '/models/FENCE_UNIT.glb', selectable: false, offset: [0, 0, 0], name: 'Fence Unit' },
];

export const SELECTABLE_ASSETS = FACTORY_ASSETS.filter((a) => a.selectable);
export const findAsset = (id) => FACTORY_ASSETS.find((a) => a.id === id) ?? null;
