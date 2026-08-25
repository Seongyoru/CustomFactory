/**
 * 배포 세 모양('/', './', '/저장소이름/')에서 자산 주소가 올바르게 나오는지 못 박는다.
 * withBase 는 순수 함수라 번들러 없이 그대로 검사한다.
 */
import { describe, expect, it } from 'vitest';
import { withBase } from './baseUrl.js';

/* 앱이 실제로 쓰는 대표 자산 경로들 */
const ASSET_PATHS = [
  '/models/CUTTING_UNIT.glb',
  '/textures/CART_UNIT_01_A.jpg',
  '/cctv/cam-01.mp4',
  '/draco/',
  '/logo.png',
];

describe('withBase — 배포 모양 3종', () => {
  it("루트 배포 '/' — 절대 경로 그대로", () => {
    expect(withBase('/models/CUTTING_UNIT.glb', '/')).toBe('/models/CUTTING_UNIT.glb');
    expect(withBase('/draco/', '/')).toBe('/draco/');
    expect(withBase('/logo.png', '/')).toBe('/logo.png');
  });

  it("상대 배포 './' — 문서 기준 상대 경로", () => {
    expect(withBase('/models/CUTTING_UNIT.glb', './')).toBe('./models/CUTTING_UNIT.glb');
    expect(withBase('/draco/', './')).toBe('./draco/');
    expect(withBase('/cctv/cam-01.mp4', './')).toBe('./cctv/cam-01.mp4');
  });

  it("프로젝트 페이지 '/저장소이름/' — 하위 경로가 앞에 붙는다", () => {
    expect(withBase('/models/CUTTING_UNIT.glb', '/some-repo/')).toBe('/some-repo/models/CUTTING_UNIT.glb');
    expect(withBase('/logo.png', '/some-repo/')).toBe('/some-repo/logo.png');
  });

  it('세 모양 전부 — 이중 슬래시가 생기지 않는다', () => {
    ['/', './', '/some-repo/'].forEach((base) => {
      ASSET_PATHS.forEach((path) => {
        expect(withBase(path, base)).not.toMatch(/([^:])\/\//);
      });
    });
  });
});

describe('withBase — 입력 형태 흡수', () => {
  it("base 말미 '/' 누락을 흡수한다", () => {
    expect(withBase('/logo.png', '/some-repo')).toBe('/some-repo/logo.png');
    expect(withBase('/logo.png', '.')).toBe('./logo.png');
  });

  it("path 선두 '/' 없이도 같은 결과", () => {
    expect(withBase('models/x.glb', './')).toBe('./models/x.glb');
    expect(withBase('models/x.glb', '/some-repo/')).toBe('/some-repo/models/x.glb');
  });

  it("base 가 비어 있으면 '/' 로 간주한다", () => {
    expect(withBase('/logo.png', '')).toBe('/logo.png');
    expect(withBase('/logo.png', undefined)).toBe('/logo.png');
  });

  it('완전한 주소(http/https/data/blob/프로토콜 상대)는 손대지 않는다', () => {
    const external = [
      'https://example.com/a.png',
      'http://example.com/a.png',
      'data:image/png;base64,AAAA',
      'blob:https://example.com/uuid',
      '//cdn.example.com/a.js',
    ];
    ['/', './', '/some-repo/'].forEach((base) => {
      external.forEach((url) => expect(withBase(url, base)).toBe(url));
    });
  });
});
