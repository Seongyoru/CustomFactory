/**
 * =============================================================================
 *  설비 마스터 데이터 (3D 씬 ↔ 우측 상세 패널 공용)
 * =============================================================================
 *  공정 개요 — HPG 라인 (1세트 단위 흐름 공정, 현장 확인 2026-08-25)
 *   1. 컨베이어가 포장 원자재 여러 개를 싣고 이재 로봇 앞까지 이송한 뒤 정지한다
 *   2. 이재(Load Transfer) 로봇이 원자재를 집어 절단기로 투입한다
 *   3. 절단기가 포장을 절단하고 내용물을 준비된 버켓에 붓는다
 *   4. 폴리 로봇이 그 버켓을 들어 카트 유닛에 실린 실린더에 충전한다
 *   5. 카트가 정위치에 오면 팝업 유닛이 위치를 잡아 주고, 실린더는 여러 세트에
 *      걸쳐 충전돼 가득 차면 뒤로 반출된다 (카트 상태 "충전 중 (n/8)"의 의미)
 *   ※ 1세트 = 원자재 1개가 라인을 통과하는 단위. 실린더 만충은 세트 여러 번의
 *     결과라서 공정을 단계별 수량으로 쪼개 세지 않는다.
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
  /**
   * 비상 정지로 세워진 상태.
   *  설비 자체의 고장이 아니라 라인 인터록이므로 ERROR 와 구분한다.
   *  색은 같은 적색이지만 맥동시키지 않는다 — 깜빡임은 '이상 발생'에만 쓰고,
   *  정지는 멈춰 있다는 사실을 그대로 보여주는 편이 읽기 쉽다.
   */
  STOPPED: { label: '작업 중지', dot: 'bg-red-500', text: 'text-red-500', ring: 'ring-red-500/40', hex: '#ef4444', pulse: false },
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
    role: 'HPG 원자재 포장 절단 → 버켓 배출',
    sn: 'Z2R8C5G1N6Q7A3',
    maker: '동양에스텍',
    mfgDate: '2020.02',
    model: 'DYS-CUT-450',
    installedAt: '2020-04-18',
    lastCheck: '2026-07-02',
    nextCheck: '2026-10-02',
    cycleSec: 42.7,
    /* 소모품 임박에 따른 '주의' 승격은 라이브 잔량(lib/maintenance.js)이 유도한다 —
       정적 상태에 박아두면 교체 후에도 주의가 남는다 */
    status: 'RUNNING',
    statusMessage: '정상 절단 중',
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
    role: '포장 원자재 이송 (이재 로봇 앞 정지)',
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
    /* 애니메이션 버전에서는 카트 대기 위치가 GLB 에 이미 구워져 있어(3.74, 0.71, -1.51)
       추가 오프셋을 주면 이중으로 밀린다. 순수 조립 좌표를 그대로 쓴다. */
    offset: [0, 0, 0],
    /**
     * 알파맵 보정.
     *  3ds Max Physical Material 의 Cutout 슬롯을 Babylon 익스포터가 인식하지 못해
     *  GLB 에 투명도가 실리지 않았다. 원본 알파맵을 런타임에 머티리얼로 물려준다.
     *  대상 머티리얼 "10 - Default" 는 CART_UNIT_GLASS 와 Object071 이 공유하는데,
     *  UV 가 이미 알파맵에 맞춰 펴져 있어 머티리얼 단위로 걸면 둘 다 올바르게 나온다.
     *    (측정값 - 알파맵 상 평균 밝기)
     *      CART_UNIT_GLASS  126/255 (125~128) → 균일한 반투명 유리
     *      Object071         80/255 (0~234)   → 불투명/투명 영역 혼재
     */
    alphaMaps: { '10 - Default': '/textures/CART_UNIT_01_A.jpg' },
    name: 'Cart Unit',
    nameKo: '실린더 충전 카트',
    role: '실린더 적재 이송 · 만충 시 반출',
    sn: 'CRT-1600-2023-00074',
    maker: '대성로보틱스',
    mfgDate: '2023.03',
    model: 'DSR-CART-16',
    installedAt: '2023-05-02',
    lastCheck: '2026-06-30',
    nextCheck: '2026-09-30',
    cycleSec: 120.0,
    status: 'RUNNING',
    statusMessage: '실린더 충전 중 (2/4)',
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
    role: '포장 원자재 파지 → 절단기 투입',
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
    role: '버켓 파지 → 실린더 충전',
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

  {
    id: 'POPUP_UNIT',
    file: '/models/POPUP_UNIT.glb',
    selectable: true,
    offset: [0, 0, 0],
    name: 'Popup Unit',
    nameKo: '팝업 승강 유닛',
    role: '카트 위치 결정(포지셔닝)',
    sn: 'PUU-2300-2024-00087',
    maker: '동양에스텍',
    mfgDate: '2024.01',
    model: 'DYS-PU-230',
    installedAt: '2024-02-20',
    lastCheck: '2026-07-12',
    nextCheck: '2026-10-12',
    cycleSec: 8.6,
    status: 'RUNNING',
    statusMessage: '승강 동작 정상',
    consumable: { label: '실린더 패킹', percent: 84 },
    history: [{ date: '2026-07-12', type: '정기점검', note: '승강 스트로크 재조정' }],
  },

  /* ---- 아래 3종은 배경/구조물이라 클릭 선택에서 제외 ---- */
  { id: 'DOPANT_BRIDGE', file: '/models/DOPANT_BRIDGE.glb', selectable: false, offset: [0, 0, 0], name: 'Dopant Bridge' },
  { id: 'DISPENSER', file: '/models/DISPENSER.glb', selectable: false, offset: [0, 0, 0], name: 'Dispenser' },
  { id: 'FENCE_UNIT', file: '/models/FENCE_UNIT.glb', selectable: false, offset: [0, 0, 0], name: 'Fence Unit' },
];

export const SELECTABLE_ASSETS = FACTORY_ASSETS.filter((a) => a.selectable);
export const findAsset = (id) => FACTORY_ASSETS.find((a) => a.id === id) ?? null;

/* ---------------------------------------------------------------------------
 * 생산 라인
 * ---------------------------------------------------------------------------
 *  위 FACTORY_ASSETS 한 벌이 라인 1대의 구성입니다. 라인을 늘릴 때는 설비를
 *  다시 정의하지 않고 이 목록에 원점만 추가하면 같은 구성이 그대로 복제됩니다.
 *
 *  Z 축으로 -10m 띄웁니다. 설비 셀이 Z ±3.45m 라 서로 겹치지 않고,
 *  건물(INTERIOR)이 Z ±26.2m 라 2호기도 같은 건물 안에 들어옵니다.
 *  → 건물 셸은 라인마다 복제하지 않고 하나만 둡니다.
 *
 *  선택된 라인만 클릭·기즈모 조작 대상이 되고, 나머지 라인은 반투명 배경으로
 *  남습니다(FactoryScene 의 INACTIVE_LINE_OPACITY).
 * ------------------------------------------------------------------------- */
export const LINE_GAP_Z = 10;
export const PRODUCTION_LINES = [
  { id: 'L1', name: 'Line_1', origin: [0, 0, 0] },
  { id: 'L2', name: 'Line_2', origin: [0, 0, -LINE_GAP_Z] },
];
export const findLine = (id) => PRODUCTION_LINES.find((l) => l.id === id) ?? PRODUCTION_LINES[0];

/* ---------------------------------------------------------------------------
 * 설비 오류 시나리오
 * ---------------------------------------------------------------------------
 *  현장 PLC/OPC-UA 에서 올라오는 알람을 흉내 낸 목록입니다. 지금은 상단의
 *  '오류 상황 테스트' 버튼이 이 중 하나를 무작위로 띄우지만, 실제 연동 시에는
 *  이 형태({ assetId, code, title, detail })로 알람을 만들어 넣으면
 *  화면 표시·알람 팝업·3D 하이라이트가 그대로 동작합니다.
 *
 *  code 는 설비 계열별로 대역을 나눠 뒀습니다(절단 2000, 이송 1000, 로봇 3000/5000,
 *  승강 4000, 카트 6000). 실제 설비 알람 코드 체계로 교체하세요.
 * ------------------------------------------------------------------------- */
export const FAULT_SCENARIOS = [
  {
    assetId: 'CUTTING_UNIT',
    code: 'E-2041',
    title: '톱날 구동 서보 과부하',
    detail: '주축 서보 드라이브에서 과전류가 검출되었습니다(정격 대비 142%). 톱날 마모 한계 도달 또는 이송 클램프 간섭이 의심됩니다.',
  },
  {
    assetId: 'CONVEYOR_UNIT',
    code: 'E-1123',
    title: '벨트 슬립 감지',
    detail: '구동 엔코더와 종동 엔코더의 회전차가 3초 이상 허용치를 초과했습니다. 벨트 장력 저하 또는 자재 끼임을 확인하세요.',
  },
  {
    assetId: 'LOAD_TRANSFER_ROBOT',
    code: 'E-3307',
    title: 'J3축 위치 편차 초과',
    detail: '지령 위치와 실제 위치의 편차가 허용 범위를 벗어났습니다(2.8mm). 파지 중 간섭 또는 감속기 백래시 증가가 의심됩니다.',
  },
  {
    assetId: 'POLY_ROBOT',
    code: 'E-5502',
    title: '툴 체인저 잠금 실패',
    detail: '툴 장착 후 잠금 확인 센서가 규정 시간(800ms) 내에 ON 되지 않았습니다. 공압 압력과 체인저 결합면을 점검하세요.',
  },
  {
    assetId: 'POPUP_UNIT',
    code: 'E-4410',
    title: '승강 실린더 하강 미완료',
    detail: '하강 지령 후 하한 리미트 센서가 감지되지 않았습니다. 실린더 패킹 누유 또는 자재 걸림 가능성이 있습니다.',
  },
  {
    assetId: 'CART_UNIT',
    code: 'E-6120',
    title: 'AGV 주행 경로 이탈',
    detail: '유도 라인 인식이 끊어져 비상 정지했습니다. 카트가 정위치를 벗어나 실린더 충전을 진행할 수 없습니다.',
  },
];

/* ---------------------------------------------------------------------------
 * 공정 애니메이션 — 키프레임 스케줄 (현장 명세 2026-08-25)
 * ---------------------------------------------------------------------------
 *  애니메이션이 있는 모든 GLB 에는 길이 7.20초짜리 "TOTAL" 클립이 들어 있고,
 *  각 설비의 동작이 그 안에 구워져 있습니다. 키프레임 실측(클립 기준):
 *
 *    CONVEYOR_UNIT        0.00 ~ 3.17s
 *    LOAD_TRANSFER_ROBOT  1.00 ~ 2.83s
 *    CUTTING_UNIT         2.57 ~ 4.87s
 *    CART_UNIT            4.67 ~ 6.77s
 *    POLY_ROBOT           4.67 ~ 7.20s
 *    POPUP_UNIT           5.00 ~ 6.73s
 *
 *  실제 공정은 "컨베이어 1회 도착 = 적재 원자재 여러 개 = 충전 여러 회 =
 *  실린더 1개"의 세트 반복 구조다 (키프레임 명세: 현장 확인 2026-08-25).
 *  클립을 통짜로 돌리지 않고 설비별 세그먼트 스케줄(ANIMATION_SCHEDULE)로
 *  재생한다 — 아래 정의 참조.
 *
 *  ※ FENCE_UNIT 의 "All Animations"(8.0s)는 3ds Max 카메라 타깃
 *    (PhysCamera001.Target)이 대상이라 재생 대상이 아닙니다.
 *    재생은 오직 "TOTAL" 클립만 합니다.
 * ------------------------------------------------------------------------- */
/**
 * 실린더 용량 — 공정 개요 5번 참조 (현장 확인: 충전 4회 = 완충).
 *  폴리 로봇이 1회 부을 때마다 1/4씩 차고, 4회째에 만충되어 뒤로 반출된다.
 *  카트의 충전 수용 연출도 4단계(176-178/179-181/182-184/185-187 프레임)로 나뉜다.
 */
export const CYLINDER_CAPACITY = 4;

/** 컨베이어 1회 적재 최대 원자재 수 — 로트 잔여 수량이 이보다 적으면 그만큼만 싣는다 */
export const CONVEYOR_LOAD_MAX = 20;

export const ANIMATION_CLIP = 'TOTAL';
export const CLIP_FPS = 30;
export const CLIP_SEC = 216 / CLIP_FPS; // 7.2s — GLB "TOTAL" 클립 원본 길이(216f)
export const REPEAT_PERIOD_F = 76; // 원자재 1개 처리 주기(프레임) — 폴리 로봇 사이클

/* 마스터 타임라인 구성 요소 (프레임) */
const ARRIVE_END_F = 40; // 컨베이어 도착 완료
const FIRST_POUR_F = 140; // 첫 충전 시작 (도입 구간 끝)
const DEPART_DUR_F = 45; // 컨베이어 출발(50~95) 길이

/** 적재 수 n 로드의 반복 종료/사이클 길이 (프레임) */
const repeatsEndF = (n) => FIRST_POUR_F + n * REPEAT_PERIOD_F;
export const cycleFramesFor = (n) => repeatsEndF(n) + DEPART_DUR_F; // 185 + 76n
export const cycleSecFor = (n) => cycleFramesFor(n) / CLIP_FPS;

/**
 * 로트 수량 → 컨베이어 로드 계획. 20개 단위로 싣고 마지막 로드는 잔여만큼.
 *  예) 50 EA → [20, 20, 10]
 */
export const loadPlanFor = (qty) => {
  const loads = [];
  let rest = Math.max(0, Math.floor(qty));
  while (rest > 0) {
    loads.push(Math.min(CONVEYOR_LOAD_MAX, rest));
    rest -= CONVEYOR_LOAD_MAX;
  }
  return loads;
};

/**
 * 로트 표준시간(초) — 애니메이션 타임라인에서 유도한다.
 *  로드 1회 = 도입(도착~첫 충전) + 반복 n회 + 마무리(반출·출발)이고, 실시간으로는
 *  반복 1회가 정확히 택트 1개이므로 로드 시간 = 택트 × (185 + 76n) / 76.
 *  → 수량 1개를 걸면 그 1개가 애니메이션을 처음부터 끝까지 통과하는 시간이 되고,
 *    2개부터는 반복 주기(택트)만큼씩만 늘어난다. 공정 완료 = 애니메이션 완료.
 */
export const lotTotalSec = (qty, taktSec) =>
  Math.max(
    1,
    Math.round(
      loadPlanFor(qty).reduce(
        (sum, n) => sum + (taktSec * cycleFramesFor(n)) / REPEAT_PERIOD_F,
        0
      )
    )
  );

/**
 * 경과시간 → 완료된 EA 수 (lotTotalSec 의 역함수).
 *  EA g 는 로드 시작 후 택트×(140+76g)/76 초에 충전이 끝난다.
 *  실린더 게이지·진행 카운트가 도입/마무리 구간을 EA 로 오인하지 않게 한다.
 */
export const completedEaAt = (elapsedSec, qty, taktSec) => {
  if (!(taktSec > 0) || !(qty > 0)) return 0;
  let done = 0;
  let t = elapsedSec;
  for (const n of loadPlanFor(qty)) {
    const loadDur = (taktSec * cycleFramesFor(n)) / REPEAT_PERIOD_F;
    if (t >= loadDur) {
      done += n;
      t -= loadDur;
      continue;
    }
    const tF = (t * REPEAT_PERIOD_F) / taktSec; // 로드 내 마스터 프레임
    done += Math.max(0, Math.min(n, Math.floor((tF - FIRST_POUR_F) / REPEAT_PERIOD_F)));
    break;
  }
  return Math.min(qty, done);
};

/** 경과시간 → 현재 로드의 적재 수(=애니메이션 반복 횟수)와 로드 내 경과 */
export const currentLoadAt = (elapsedSec, qty, taktSec) => {
  const plan = loadPlanFor(qty);
  if (plan.length === 0 || !(taktSec > 0)) {
    return { repeats: CONVEYOR_LOAD_MAX, loadElapsedSec: 0 };
  }
  let t = Math.max(0, elapsedSec);
  for (const n of plan) {
    const loadDur = (taktSec * cycleFramesFor(n)) / REPEAT_PERIOD_F;
    if (t < loadDur) return { repeats: n, loadElapsedSec: t };
    t -= loadDur;
  }
  return { repeats: plan[plan.length - 1], loadElapsedSec: 0 };
};

/**
 * 적재 수 n 에 대한 설비별 재생 스케줄 (전개된 세그먼트 목록, at 오름차순).
 *  { at: 마스터 프레임, from~to: 클립 프레임 } — 세그먼트 사이/이전은 직전 포즈 고정.
 *
 *   CONVEYOR  0~40 도착 정지 ─────────────────── [반복 끝] 50~95 출발
 *   ROBOT           30~85 이재 ×n (76f 주기)
 *   CUTTING             77~146 절단 ×n
 *   POLY                     140~216 충전 ×n (주기와 같아 연속)
 *   CART                     140~175 진입 · 충전 수용 4단계(176-178/…/185-187)
 *                            · 4회 찰 때마다 188~203 실린더 반출
 *   POPUP                       150~157 위치 결정 고정 ── [반복 끝+7f] 195~202 리커버리
 *
 *  실린더 반출(188~203)은 로드 내 4회째 충전 직후마다 재생된다 — 20개 로드면
 *  5회. 로드 경계에서 남은 부분 충전 실린더는 다음 로드로 이어진다(연출은
 *  로드 기준, 수량 집계는 엔진 기준이라 미세한 위상차는 허용).
 */
const scheduleCache = new Map();
export const scheduleFor = (n) => {
  const count = Math.max(1, Math.min(CONVEYOR_LOAD_MAX, Math.floor(n) || 1));
  if (scheduleCache.has(count)) return scheduleCache.get(count);

  const endF = repeatsEndF(count);
  const robot = [];
  const cutting = [];
  const poly = [];
  const cartSegs = [{ at: 140, from: 140, to: 175 }]; // 진입·정렬
  for (let k = 0; k < count; k++) {
    robot.push({ at: 30 + k * REPEAT_PERIOD_F, from: 30, to: 85 });
    cutting.push({ at: 77 + k * REPEAT_PERIOD_F, from: 77, to: 146 });
    poly.push({ at: 140 + k * REPEAT_PERIOD_F, from: 140, to: 216 });
    /* 충전 수용 — k회째 충전은 실린더의 (k%4)+1 단계 (3프레임씩) */
    const step = k % CYLINDER_CAPACITY;
    cartSegs.push({ at: 176 + k * REPEAT_PERIOD_F, from: 176 + step * 3, to: 178 + step * 3 });
    /* 4회째마다 만충 — 실린더 반출 후 새 실린더 */
    if (step === CYLINDER_CAPACITY - 1) {
      cartSegs.push({ at: 180 + k * REPEAT_PERIOD_F, from: 188, to: 203 });
    }
  }

  const schedule = {
    CONVEYOR_UNIT: [
      { at: 0, from: 0, to: ARRIVE_END_F },
      { at: endF, from: 50, to: 95 },
    ],
    LOAD_TRANSFER_ROBOT: robot,
    CUTTING_UNIT: cutting,
    POLY_ROBOT: poly,
    CART_UNIT: cartSegs,
    POPUP_UNIT: [
      { at: 150, from: 150, to: 157 },
      { at: endF + 7, from: 195, to: 202 },
    ],
  };
  scheduleCache.set(count, schedule);
  return schedule;
};

/** 라인 사이클 시각(초) → 이 설비의 클립 재생 시각(초). repeats = 현재 로드 적재 수 */
export const clipTimeFor = (assetId, cycleTime, repeats = CONVEYOR_LOAD_MAX) => {
  const segs = scheduleFor(repeats)[assetId];
  if (!segs || segs.length === 0) return 0; // 스케줄 없는 배경 설비 — 첫 포즈 고정
  const tF = cycleTime * CLIP_FPS;
  let frame = segs[0].from; // 첫 세그먼트 시작 전 — 시작 포즈
  for (const seg of segs) {
    if (tF < seg.at) break;
    frame = seg.from + Math.min(seg.to - seg.from, tF - seg.at);
  }
  return frame / CLIP_FPS;
};

/** 사이클(로드 1회)당 실가동 프레임 — 병목 분석의 근거 */
export const busyFramesOf = (assetId, repeats = CONVEYOR_LOAD_MAX) =>
  (scheduleFor(repeats)[assetId] ?? []).reduce((sum, seg) => sum + (seg.to - seg.from), 0);

/**
 * 공정 시퀀스 HUD 단계 — 핵심 흐름만 간추린 표시용.
 *  (카트 위치 결정·팝업 리커버리 같은 보조 동작은 3D 에는 있지만 HUD 에서는 뺀다)
 */
const phasesCache = new Map();
export const processPhasesFor = (repeats = CONVEYOR_LOAD_MAX) => {
  const n = Math.max(1, Math.min(CONVEYOR_LOAD_MAX, Math.floor(repeats) || 1));
  if (phasesCache.has(n)) return phasesCache.get(n);
  const f = (frame) => +(frame / CLIP_FPS).toFixed(2);
  const endF = repeatsEndF(n);
  const exits = Math.floor(n / CYLINDER_CAPACITY);
  const phases = [
    { id: 'CONVEYOR_UNIT', label: '원자재 도착', start: 0, end: f(ARRIVE_END_F) },
    { id: 'LOAD_TRANSFER_ROBOT', label: `원자재 이재 ×${n}`, start: f(30), end: f(30 + (n - 1) * REPEAT_PERIOD_F + 55) },
    { id: 'CUTTING_UNIT', label: `개포장 절단 ×${n}`, start: f(77), end: f(77 + (n - 1) * REPEAT_PERIOD_F + 69) },
    { id: 'POLY_ROBOT', label: `실린더 충전 ×${n}`, start: f(140), end: f(endF) },
    ...(exits > 0
      ? [{
          id: 'CART_UNIT',
          label: exits > 1 ? `만충 반출 ×${exits}` : '만충 반출',
          start: f(180 + (CYLINDER_CAPACITY - 1) * REPEAT_PERIOD_F),
          end: f(180 + (exits * CYLINDER_CAPACITY - 1) * REPEAT_PERIOD_F + 15),
        }]
      : []),
    { id: 'CONVEYOR_UNIT', label: '컨베이어 출발', start: f(endF), end: f(endF + DEPART_DUR_F) },
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  phasesCache.set(n, phases);
  return phases;
};
