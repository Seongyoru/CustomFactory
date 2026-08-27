/**
 * =============================================================================
 *  EGIS 서버 저장소 (참조 구현) — localStorage 를 중앙 JSON 파일로
 * =============================================================================
 *  대시보드의 저장 계층(src/lib/persist.js)이 이 서버를 원격 저장소로 쓴다:
 *   - 부팅 시 GET /store 스냅샷을 localStorage 에 선주입한 뒤 앱이 뜬다
 *   - 이후 모든 저장은 로컬에 쓰고 이 서버에도 써 둔다(write-through)
 *  → 브라우저/PC 를 바꿔도 같은 상태로 시작하고, 감사 로그가 중앙에 남는다.
 *
 *  [ API ]  키는 대시보드의 localStorage 키 그대로(불투명 문자열)
 *   GET    /store          → { rev, keys: { "<key>": <값(JSON)> } }
 *   PUT    /store/<key>    body=JSON 값 → 저장
 *   DELETE /store/<key>    → 키 삭제
 *   DELETE /store          → 전체 삭제 (데모 데이터 초기화와 짝)
 *
 *  저장은 단일 JSON 파일(원자적 tmp→rename). 참조 구현이므로 인증이 없다 —
 *  사내망 밖에 두려면 리버스 프록시에서 인증·TLS 를 붙일 것.
 *  실행: npm run persist   (기본 포트 8126, --port·--file 로 변경)
 * ---------------------------------------------------------------------------
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', 8126));
const FILE = resolve(here, arg('file', 'persist-data.json'));
const MAX_BODY = 2 * 1024 * 1024; // 값 하나 2MB — 이벤트 로그도 넉넉

let store = { rev: 0, keys: {} };
if (existsSync(FILE)) {
  try {
    store = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    console.warn(`[persist] 저장 파일 파싱 실패 — 빈 저장소로 시작 (${FILE})`);
  }
}

let saveTimer = null;
const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(store));
    renameSync(tmp, FILE); // 원자적 교체 — 쓰다 죽어도 파일이 반쪽 나지 않는다
  }, 300);
};

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
};
const json = (res, code, body) => {
  cors(res);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    return res.end();
  }
  if (!url.pathname.startsWith('/store')) return json(res, 404, { error: 'not found' });
  const key = decodeURIComponent(url.pathname.slice('/store'.length).replace(/^\//, ''));

  if (req.method === 'GET' && key === '') {
    return json(res, 200, store);
  }
  if (req.method === 'DELETE') {
    if (key === '') {
      store = { rev: store.rev + 1, keys: {} };
      console.log('[persist] 전체 초기화');
    } else if (key in store.keys) {
      delete store.keys[key];
      store.rev += 1;
    }
    scheduleSave();
    return json(res, 200, { rev: store.rev });
  }
  if (req.method === 'PUT' && key !== '') {
    let body = '';
    let over = false;
    req.on('data', (c) => {
      body += c;
      if (body.length > MAX_BODY && !over) {
        over = true;
        json(res, 413, { error: 'too large' });
        req.destroy();
      }
    });
    req.on('end', () => {
      if (over) return;
      try {
        store.keys[key] = JSON.parse(body);
      } catch {
        return json(res, 400, { error: 'invalid JSON' });
      }
      store.rev += 1;
      scheduleSave();
      json(res, 200, { rev: store.rev });
    });
    return;
  }
  json(res, 405, { error: 'method not allowed' });
}).listen(PORT, () => {
  console.log(`[persist] http://localhost:${PORT}/store — 파일 ${FILE}`);
  console.log(`[persist] 보관 중 키 ${Object.keys(store.keys).length}개 (rev ${store.rev})`);
});
