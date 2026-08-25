/**
 * =============================================================================
 *  정적 자산 기준 경로 — 배포 위치가 어디든 자산 주소가 깨지지 않게 한다
 * =============================================================================
 *  이 앱은 세 가지 모양으로 배포될 수 있다:
 *    '/'                 개발 서버, 도메인 루트 배포
 *    './'                상대 경로 배포 (GitHub Pages 등 — vite base './')
 *    '/저장소이름/'       프로젝트 페이지를 절대 경로로 서빙하는 경우
 *
 *  코드 어디에도 '/models/…' 같은 루트 절대 주소를 그대로 쓰지 말고,
 *  반드시 assetUrl() 을 거쳐야 한다. 실제 결합 규칙은 withBase() 순수 함수에
 *  있고, 세 배포 모양 전부 baseUrl.test.js 가 못 박는다.
 * ---------------------------------------------------------------------------
 */

/** 완전한 URL(스킴 있음)이나 프로토콜 상대(//) 주소인지 — 이런 건 손대지 않는다 */
const isExternal = (path) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path);

/**
 * 순수 함수: 기준 경로(base)와 자산 경로(path)를 결합한다.
 *  - base 는 밖에서 주입한다 — 번들러·프레임워크에 묶이지 않아 그대로 테스트된다.
 *  - path 의 선두 '/' 유무, base 의 말미 '/' 유무를 모두 흡수한다.
 *  - http(s)·data:·blob: 등 완전한 주소는 그대로 통과시킨다.
 */
export function withBase(path, base) {
  const p = String(path ?? '');
  if (isExternal(p)) return p;
  const b = base == null || base === '' ? '/' : String(base);
  const normBase = b.endsWith('/') ? b : `${b}/`;
  const normPath = p.startsWith('/') ? p.slice(1) : p;
  return normBase + normPath;
}

/**
 * 실행 시점의 기준 경로를 주입한 버전 — 앱 코드는 이것만 쓴다.
 *  vite 가 빌드 설정의 base 를 import.meta.env.BASE_URL 로 넣어 준다.
 *  (dev 서버 '/', 정적 빌드 './')
 */
export const assetUrl = (path) => withBase(path, import.meta.env.BASE_URL);
