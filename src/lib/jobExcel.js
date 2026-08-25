/**
 * =============================================================================
 *  작업 지시 엑셀 파싱 / 검증 / 양식 생성
 * =============================================================================
 *  SheetJS(xlsx)로 브라우저에서 직접 .xlsx / .xls / .csv 를 읽습니다. 서버 불필요.
 *
 *  현장 표준 양식이 아직 없어 작업 카탈로그 구조를 그대로 따릅니다.
 *   필수 : 작업명 / 수량(EA) / 표준시간(분)
 *   선택 : 설비 / 우선순위 / 비고
 *
 *  헤더는 한글·영문 별칭을 모두 인식합니다. 현장 파일은 헤더 표기가 제각각이라
 *  정확 일치만 요구하면 대부분 실패하기 때문입니다.
 * ---------------------------------------------------------------------------
 */

/* xlsx 는 큰 라이브러리라 정적으로 묶지 않는다 — 엑셀 기능을 처음 쓸 때만 내려받는다 */
const loadXLSX = () => import('xlsx');

/** 컬럼 별칭 — 소문자·공백/특수문자 제거 후 비교 */
const COLUMN_ALIASES = {
  name: ['작업명', '작업', '작업내용', '품명', '공정명', 'job', 'jobname', 'name', 'task', 'operation'],
  qty: ['수량', '수량ea', '개수', '생산수량', '지시수량', 'qty', 'quantity', 'count', 'ea'],
  minutes: ['표준시간분', '표준시간', '소요시간', '작업시간', '표준공수', 'minutes', 'min', 'duration', 'std', 'stdtime'],
  equipment: ['설비', '설비명', '호기', 'equipment', 'machine', 'resource'],
  priority: ['우선순위', '순위', 'priority', 'order', 'seq'],
  note: ['비고', '메모', '특이사항', 'note', 'remark', 'comment'],
};

const normalize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[\s_\-()[\]{}./\\]/g, '')
    .replace(/[()]/g, '');

/** 헤더 행 → { 필드: 컬럼인덱스 } */
function mapHeaders(headerRow) {
  const mapping = {};
  const unmatched = [];

  headerRow.forEach((raw, idx) => {
    const key = normalize(raw);
    if (!key) return;
    const field = Object.keys(COLUMN_ALIASES).find((f) =>
      COLUMN_ALIASES[f].some((alias) => normalize(alias) === key)
    );
    if (field && mapping[field] === undefined) mapping[field] = idx;
    else if (!field) unmatched.push(String(raw));
  });

  return { mapping, unmatched };
}

/** 숫자 파싱 — "1,200", "120 EA", "15분" 같은 현장 표기를 흡수 */
function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v ?? '').replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * 파일 → 검증된 행 목록
 * @returns {Promise<{rows, mapping, unmatched, sheetName, missingRequired}>}
 */
export async function parseJobWorkbook(file, existingNames = []) {
  const XLSX = await loadXLSX();
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];

  // header:1 → 2차원 배열. 병합/빈칸이 섞여도 위치가 밀리지 않는다.
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  if (grid.length === 0) {
    return { rows: [], mapping: {}, unmatched: [], sheetName, missingRequired: ['작업명', '수량', '표준시간'] };
  }

  // 헤더가 1행에 없을 수 있으므로(제목/공백 행) 상위 10행 중 가장 많이 매칭되는 행을 헤더로 본다
  let headerIdx = 0;
  let best = { mapping: {}, unmatched: [], score: -1 };
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    const r = mapHeaders(grid[i]);
    const score = Object.keys(r.mapping).length;
    if (score > best.score) {
      best = { ...r, score };
      headerIdx = i;
    }
  }

  const { mapping, unmatched } = best;
  const missingRequired = ['name', 'qty', 'minutes']
    .filter((f) => mapping[f] === undefined)
    .map((f) => ({ name: '작업명', qty: '수량', minutes: '표준시간(분)' }[f]));

  if (missingRequired.length > 0) {
    return { rows: [], mapping, unmatched, sheetName, missingRequired };
  }

  const seen = new Set(existingNames.map((n) => normalize(n)));
  const rows = [];

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i];
    const name = String(raw[mapping.name] ?? '').trim();
    const qty = toNumber(raw[mapping.qty]);
    const minutes = toNumber(raw[mapping.minutes]);

    // 완전히 빈 행은 조용히 건너뛴다
    if (!name && qty === null && minutes === null) continue;

    const errors = [];
    if (!name) errors.push('작업명 없음');
    if (qty === null) errors.push('수량 없음');
    else if (!Number.isInteger(qty) || qty <= 0) errors.push('수량은 1 이상 정수');
    if (minutes === null) errors.push('표준시간 없음');
    else if (minutes <= 0) errors.push('표준시간은 0보다 커야 함');

    const key = normalize(name);
    if (name && seen.has(key)) errors.push('중복 작업명');
    if (name) seen.add(key);

    rows.push({
      excelRow: i + 1, // 엑셀 화면상의 행 번호(1-based)
      name,
      qty: qty ?? 0,
      minutes: minutes ?? 0,
      totalSec: Math.round((minutes ?? 0) * 60),
      equipment: mapping.equipment !== undefined ? String(raw[mapping.equipment] ?? '').trim() : '',
      priority: mapping.priority !== undefined ? toNumber(raw[mapping.priority]) : null,
      note: mapping.note !== undefined ? String(raw[mapping.note] ?? '').trim() : '',
      errors,
      valid: errors.length === 0,
    });
  }

  return { rows, mapping, unmatched, sheetName, missingRequired: [] };
}

/** 빈 양식(.xlsx) 생성 후 다운로드 — 컬럼 형식을 글로 설명하는 것보다 확실하다 */
export async function downloadJobTemplate() {
  const XLSX = await loadXLSX();
  const rows = [
    ['작업명', '수량', '표준시간(분)', '설비', '우선순위', '비고'],
    ['HPG 원자재 개포장', 120, 15, 'CUTTING_UNIT', 1, '예시 행 - 삭제 후 사용하세요'],
    ['실린더 충전 (CART-01)', 240, 25, 'POLY_ROBOT', 2, ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 14 }, { wch: 20 }, { wch: 10 }, { wch: 32 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '작업지시');
  XLSX.writeFile(wb, '작업지시_양식.xlsx');
}

export const REQUIRED_COLUMNS = ['작업명', '수량', '표준시간(분)'];
export const OPTIONAL_COLUMNS = ['설비', '우선순위', '비고'];
