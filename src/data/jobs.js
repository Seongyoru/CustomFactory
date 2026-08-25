/**
 * =============================================================================
 *  작업 대기열 초기 데이터 / 발번 / 단계 분류
 * =============================================================================
 */
import { FACTORY_ASSETS, PRODUCTION_LINES } from './factoryAssets.js';

/**
 * 작업지시 번호 발번.
 *  대기열 '길이'로 번호를 만들면 작업을 취소한 뒤 추가할 때 이미 쓴 번호가 다시
 *  나온다(취소로 5→4건이 된 뒤 추가하면 또 005). React key 가 겹치고 목록이
 *  깨지므로, 지금까지 쓴 가장 큰 번호에서 이어 붙인다.
 */
export const makeJobId = (seq) => `WO-2607-${String(seq).padStart(3, '0')}`;
export const nextJobSeq = (jobs) =>
  jobs.reduce((max, j) => Math.max(max, Number(String(j.id).split('-').pop()) || 0), 0) + 1;

/* 작업 카탈로그 — '작업 추가' 팝업에서 선택하거나 새로 등록한다 */
export const INITIAL_JOB_TEMPLATES = [
  { id: 'TPL-01', name: 'HPG 원자재 개포장', qty: 120, totalSec: 900 },
  { id: 'TPL-02', name: 'HPG 원자재 이송', qty: 80, totalSec: 720 },
  { id: 'TPL-03', name: '실린더 충전 (CART-01)', qty: 240, totalSec: 1500 },
  { id: 'TPL-04', name: '충전 후 계량/검사', qty: 36, totalSec: 480 },
  { id: 'TPL-05', name: '공(空)실린더 회수/세척', qty: 60, totalSec: 600 },
];

const INITIAL_JOB_SPECS = [
  { name: 'HPG 원자재 개포장', qty: 120, totalSec: 900, state: 'RUNNING' },
  { name: 'HPG 원자재 이송', qty: 80, totalSec: 720, state: 'IDLE' },
  { name: '실린더 충전 (CART-01)', qty: 240, totalSec: 1500, state: 'IDLE' },
  { name: '충전 후 계량/검사', qty: 36, totalSec: 480, state: 'ERROR' },
  { name: '공(空)실린더 회수/세척', qty: 60, totalSec: 600, state: 'IDLE' },
];

/**
 * 라인마다 자기 대기열을 갖는다. 라인은 같은 설비 구성이라 작업 종류도 같지만,
 * 지시 번호는 라인끼리 겹치지 않게 100번대씩 띄운다 (1호기 001~, 2호기 101~).
 */
const makeInitialJobs = (lineIndex) =>
  INITIAL_JOB_SPECS.map((spec, i) => ({ id: makeJobId(lineIndex * 100 + i + 1), ...spec }));

export const INITIAL_JOBS_BY_LINE = Object.fromEntries(
  PRODUCTION_LINES.map((line, i) => [line.id, makeInitialJobs(i)])
);

/** 설비 배치도 라인별로 따로 관리한다 — 한쪽에서 옮겨도 다른 라인은 그대로다 */
export const INITIAL_OFFSETS_BY_LINE = Object.fromEntries(
  PRODUCTION_LINES.map((line) => [
    line.id,
    Object.fromEntries(FACTORY_ASSETS.map((a) => [a.id, [...a.offset]])),
  ])
);

/**
 * 생산 라인 4단계.
 *  대기열의 작업을 이름으로 단계에 배정해 단계별 진행률을 낸다.
 *  판정 순서가 표시 순서와 다른 이유: "충전 후 계량/검사" 처럼 두 단어가 겹치는
 *  작업이 있어서, 더 좁은 규칙(검사)을 넓은 규칙(충전)보다 먼저 본다.
 */
export const STAGE_ORDER = ['개포장', '이송', '충전', '검사'];
export const stageOf = (name = '') => {
  if (/개포장|절단/.test(name)) return '개포장';
  if (/검사|계량/.test(name)) return '검사';
  if (/충전/.test(name)) return '충전';
  if (/이송|회수|세척/.test(name)) return '이송';
  return null; // 어느 단계에도 속하지 않는 작업은 집계에서 뺀다
};

export const CCTV_FEEDS = [
  { id: 'CAM-01', label: 'Line_1 · 절단기 상부', src: '/cctv/cam-01.mp4' },
  { id: 'CAM-02', label: 'Line_1 · 컨베이어 정면', src: '/cctv/cam-02.mp4' },
];
