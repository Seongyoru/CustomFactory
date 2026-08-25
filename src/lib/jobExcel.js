/**
 * =============================================================================
 *  로트(생산 오더) 엑셀 파싱 / 검증 / 양식 생성
 * =============================================================================
 *  SheetJS(xlsx)로 브라우저에서 직접 .xlsx / .xls / .csv 를 읽습니다. 서버 불필요.
 *
 *  작업지시는 로트(품목 + 수량) 단위입니다:
 *   필수 : 품목명 / 수량(EA)
 *   선택 : 택트타임(초/EA) / 우선순위 / 비고
 *
 *  택트타임이 비어 있으면 품목 카탈로그에서 찾아 채웁니다. 카탈로그에도 없는
 *  품목은 택트타임을 직접 적어야 하며, 반영 시 카탈로그에 자동 등록됩니다.
 *
 *  헤더는 한글·영문 별칭을 모두 인식합니다. 현장 파일은 헤더 표기가 제각각이라
 *  정확 일치만 요구하면 대부분 실패하기 때문입니다.
 * ---------------------------------------------------------------------------
 */

/* xlsx 는 큰 라이브러리라 정적으로 묶지 않는다 — 엑셀 기능을 처음 쓸 때만 내려받는다 */
const loadXLSX = () => import('xlsx');

/** 컬럼 별칭 — 소문자·공백/특수문자 제거 후 비교 */
const COLUMN_ALIASES = {
  name: ['품목명', '품목', '제품명', '제품', '품명', '모델명', 'product', 'item', 'name', 'sku'],
  qty: ['수량', '수량ea', '개수', '생산수량', '지시수량', '로트수량', 'qty', 'quantity', 'count', 'ea'],
  takt: ['택트타임초ea', '택트타임', '택트', '택트초', '사이클타임', '초ea', 'takt', 'takttime', 'cycletime', 'cycle', 'cyclesec', 'sec'],
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

/** 숫자 파싱 — "1,200", "120 EA", "7.5초" 같은 현장 표기를 흡수 */
function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v ?? '').replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * 파일 → 검증된 로트 행 목록
 * @param file 업로드 파일
 * @param products 품목 카탈로그 — 택트타임이 빈 행을 여기서 채운다
 * @returns {Promise<{rows, mapping, unmatched, sheetName, missingRequired}>}
 */
export async function parseJobWorkbook(file, products = []) {
  const XLSX = await loadXLSX();
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];

  // header:1 → 2차원 배열. 병합/빈칸이 섞여도 위치가 밀리지 않는다.
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  if (grid.length === 0) {
    return { rows: [], mapping: {}, unmatched: [], sheetName, missingRequired: ['품목명', '수량'] };
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
  const missingRequired = ['name', 'qty']
    .filter((f) => mapping[f] === undefined)
    .map((f) => ({ name: '품목명', qty: '수량' }[f]));

  if (missingRequired.length > 0) {
    return { rows: [], mapping, unmatched, sheetName, missingRequired };
  }

  const catalogByName = new Map(products.map((p) => [normalize(p.name), p]));
  const rows = [];

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i];
    const name = String(raw[mapping.name] ?? '').trim();
    const qty = toNumber(raw[mapping.qty]);
    const taktRaw = mapping.takt !== undefined ? toNumber(raw[mapping.takt]) : null;

    // 완전히 빈 행은 조용히 건너뛴다
    if (!name && qty === null && taktRaw === null) continue;

    const catalogHit = name ? catalogByName.get(normalize(name)) ?? null : null;
    const taktSec = taktRaw ?? catalogHit?.taktSec ?? null;

    const errors = [];
    if (!name) errors.push('품목명 없음');
    if (qty === null) errors.push('수량 없음');
    else if (!Number.isInteger(qty) || qty <= 0) errors.push('수량은 1 이상 정수');
    if (taktRaw !== null && taktRaw <= 0) errors.push('택트타임은 0보다 커야 함');
    if (name && taktSec === null) errors.push('미등록 품목 — 택트타임(초/EA) 필요');

    rows.push({
      excelRow: i + 1, // 엑셀 화면상의 행 번호(1-based)
      name,
      qty: qty ?? 0,
      taktSec: taktSec ?? 0,
      totalSec: taktSec && qty ? Math.max(1, Math.round(taktSec * qty)) : 0,
      knownProduct: Boolean(catalogHit),
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
    ['품목명', '수량', '택트타임(초/EA)', '우선순위', '비고'],
    ['HPG 실린더 6L', 120, '', 1, '카탈로그 품목은 택트타임 생략 가능'],
    ['HPG 실린더 10L', 80, '', 2, ''],
    ['신규 품목 예시', 60, 8.5, 3, '미등록 품목은 택트타임 필수 — 반영 시 카탈로그 자동 등록'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 16 }, { wch: 10 }, { wch: 42 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '생산오더');
  XLSX.writeFile(wb, '생산오더_양식.xlsx');
}

export const REQUIRED_COLUMNS = ['품목명', '수량'];
export const OPTIONAL_COLUMNS = ['택트타임(초/EA)', '우선순위', '비고'];
