/**
 * =============================================================================
 *  FactoryScene - 디지털 트윈 3D 씬 (react-three-fiber)
 * =============================================================================
 *  배치 원칙
 *   GLB 에는 조립 상태의 상대 좌표가 이미 구워져 있고 업축(Y-up)도 내장돼 있습니다.
 *   따라서 회전·중심정렬·바닥안착을 일절 적용하지 않고 원본 좌표 그대로 로드해야
 *   설비들이 조립된 형태로 맞물립니다.
 *   (측정값: FENCE_UNIT = 원점 기준 4.46×3.20×6.91m 셀, 나머지 설비가 그 안에 안착.
 *    전 모델 Y 최소값이 0 이라 바닥 보정도 불필요)
 *   유일한 예외가 이동체인 Cart 로, 데이터의 offset 으로 셀 밖에 주차시킵니다.
 *
 *  선택(픽킹)
 *   r3f 의 이벤트 시스템은 핸들러가 달린 객체만 레이캐스트합니다.
 *   따라서 selectable:false 인 FENCE/DOPANT/DISPENSER 와 건물 셸에는
 *   핸들러를 붙이지 않는 것만으로 클릭 가로채기가 원천 차단됩니다.
 * ---------------------------------------------------------------------------
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls, TransformControls, useGLTF, useProgress } from '@react-three/drei';
import * as THREE from 'three';
import {
  ANIMATION_CLIP,
  FACTORY_ASSETS,
  PRODUCTION_LINES,
  PROCESS_CYCLE_SEC,
  SHELL_ASSET,
  STATUS,
} from '../data/factoryAssets.js';
import { assetUrl } from '../lib/baseUrl.js';

/* 설비 셀이 4.5×3.2×6.9m 규모라 카메라도 가깝게 잡는다 */
const CAMERA_HOME = { position: [8.5, 5.2, 9.5], target: [0.4, 1.3, 0] };

/**
 * 그리드를 바닥에서 살짝 띄우는 높이(m).
 *  인테리어 바닥 상면이 Y=0 이라 같은 높이에 두면 깊이값이 겹친다.
 *  3cm 는 22×52m 공간에서 눈에 띄지 않으면서 깊이 겹침을 확실히 피한다.
 *  ※ 반짝임의 진짜 원인이었던 투명 오브젝트 정렬 문제는 FactoryShell 의
 *    renderOrder(-1) 고정으로 해결한다 — 해당 주석 참조.
 */
const GRID_LIFT = 0.03;

/**
 * 선택되지 않은 라인의 불투명도.
 *  형태는 알아볼 수 있으면서 활성 라인을 가리지 않는 값. 0 으로 두면 라인이
 *  통째로 사라져 '어디에 뭐가 있는지' 감이 없어지므로 흐리게 남긴다.
 */
const INACTIVE_LINE_OPACITY = 0.16;

/* ---------------------------------------------------------------------------
 * GLB 를 원본 좌표 그대로 복제한다.
 * useGLTF 는 URL 별로 동일 인스턴스를 캐시하므로 반드시 clone 해서 쓴다.
 * ------------------------------------------------------------------------- */
/**
 * Draco 디코더 경로.
 *  GLB 는 전부 Draco 압축돼 있다(원본 43.9MB → 18.4MB). 디코더를 CDN 이 아니라
 *  public/draco 에 번들해 두어 폐쇄망(공장 내부망)에서도 동작한다.
 *  모든 자산 주소는 assetUrl 로 배포 기준 경로를 붙인다 (하위 경로 배포 대응).
 */
const DRACO_DECODER_PATH = '/draco/';

function useAssembledModel(url, { transparent = false, opacity = 1 } = {}) {
  const { scene, animations } = useGLTF(assetUrl(url), assetUrl(DRACO_DECODER_PATH));

  const result = useMemo(() => {
    const object = scene.clone(true);
    object.updateMatrixWorld(true);

    // 조립 좌표를 유지한 채 자기 공간에서의 바운딩 박스만 계산 (선택 박스용)
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // 공유 머티리얼 변형을 막기 위해 사본을 만든다
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.material = child.material.clone();
      // 얇은 CAD 판재 때문에 양면 렌더가 필요하지만, 투명 재질에 걸면
      // 앞뒤 면이 서로 정렬 문제를 일으키므로 불투명 재질에만 적용한다.
      if (!child.material.transparent) child.material.side = THREE.DoubleSide;
      if (transparent) {
        child.material.transparent = true;
        child.material.opacity = opacity;
        child.material.depthWrite = false;
      }
    });

    return { object, size, center };
  }, [scene, transparent, opacity]);

  return { ...result, animations };
}

/* ---------------------------------------------------------------------------
 * 알파맵 보정
 * ---------------------------------------------------------------------------
 *  3ds Max Physical Material 의 Cutout 슬롯을 Babylon 익스포터가 인식하지 못해
 *  일부 GLB 에 투명도가 실리지 않았다. 원본 알파맵을 런타임에 물려 복원한다.
 *
 *  flipY = false 가 핵심이다. glTF 는 UV 원점이 좌상단인데 TextureLoader 는
 *  기본이 좌하단(flipY=true)이라, 뒤집힌 채로 샘플링하면 유리 UV 자리가
 *  전부 알파 0 인 영역을 가리켜 메시가 통째로 사라진다.
 *  (측정: 정방향 126/255 균일 · 뒤집으면 0)
 * ------------------------------------------------------------------------- */
function useAlphaMapOverride(object, alphaMaps) {
  useEffect(() => {
    if (!alphaMaps) return undefined;
    const loader = new THREE.TextureLoader();
    const loaded = [];

    Object.entries(alphaMaps).forEach(([materialName, url]) => {
      loader.load(assetUrl(url), (tex) => {
        tex.flipY = false;
        tex.colorSpace = THREE.NoColorSpace; // 색이 아니라 마스크 데이터
        loaded.push(tex);
        object.traverse((child) => {
          if (!child.isMesh || child.material?.name !== materialName) return;
          child.material.alphaMap = tex;
          child.material.transparent = true;
          child.material.alphaTest = 0.05; // 완전 투명 텍셀은 폐기해 깊이 오염 방지
          child.material.side = THREE.FrontSide;
          child.material.needsUpdate = true;
        });
      });
    });

    return () => loaded.forEach((t) => t.dispose());
  }, [object, alphaMaps]);
}

/* ---------------------------------------------------------------------------
 * 공정 애니메이션
 * ---------------------------------------------------------------------------
 *  한 라인의 모든 설비는 "TOTAL"(7.2s) 을 하나의 공유 시계로 같은 시각에 재생한다.
 *  mixer.update(delta) 를 설비마다 돌리면 프레임 누락 시 서로 어긋나므로,
 *  절대시각을 지정하는 mixer.setTime() 을 써서 프레임 단위로 동기를 보장한다.
 *
 *  시계는 '라인마다 하나'다. 비상 정지가 라인 단위로 걸리기 때문에, 한 라인이
 *  멈춰도 다른 라인은 계속 돌아가야 한다. 프레임 스탬프 가드도 시계별로 작동하므로
 *  라인이 늘어도 각 시계는 프레임당 정확히 한 번만 전진한다.
 *
 *  시계 전진은 프레임당 정확히 한 번만 일어나야 한다. 설비별 useFrame 이
 *  각자 전진시키면 설비 수만큼 빨라지기 때문에, 프레임 스탬프로 가드를 건다.
 *  (별도 클럭 컴포넌트 + useFrame priority 방식은 r3f 에서 자동 렌더링을
 *   꺼버리는 부작용이 있어 쓰지 않는다)
 * ------------------------------------------------------------------------- */
function advanceProcessClock(clock, state, delta) {
  const stamp = state.clock.elapsedTime;
  if (clock.stamp === stamp) return; // 이번 프레임엔 이미 누군가 전진시킴
  clock.stamp = stamp;
  if (clock.paused) return;
  clock.time = (clock.time + delta * clock.timeScale) % PROCESS_CYCLE_SEC;
}

function useProcessAnimation(object, animations, clock) {
  const mixer = useMemo(() => {
    const clip = animations?.find((a) => a.name === ANIMATION_CLIP);
    if (!clip) return null;
    return new THREE.AnimationMixer(object);
  }, [object, animations]);

  /**
   * play() 는 반드시 effect 안에서 해야 한다.
   * StrictMode 는 mount → unmount → remount 를 한 번 돌리는데,
   * useMemo 안에서만 play 하면 언마운트 정리에서 멈춘 액션이 다시 살아나지 못해
   * 믹서·바인딩은 멀쩡한데 액션만 정지(_nActiveActions=0)한 상태가 된다.
   */
  useEffect(() => {
    if (!mixer) return undefined;
    const clip = animations.find((a) => a.name === ANIMATION_CLIP);
    const action = mixer.clipAction(clip);
    action.reset().play();
    return () => action.stop();
  }, [mixer, animations]);

  /* 개발 모드 진단용 — 콘솔에서 window.__mixers 로 클립/바인딩/재생 상태 확인 */
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const entry = {
      clips: (animations ?? []).map((a) => a.name),
      hasTotal: Boolean(animations?.find((a) => a.name === ANIMATION_CLIP)),
      mixer,
    };
    window.__mixers = window.__mixers ?? [];
    window.__mixers.push(entry);
    return () => {
      window.__mixers = window.__mixers.filter((e) => e !== entry);
    };
  }, [animations, mixer]);

  useFrame((state, delta) => {
    advanceProcessClock(clock, state, delta);
    if (mixer) mixer.setTime(clock.time);
  });

  return Boolean(mixer);
}

/* ---------------------------------------------------------------------------
 * 오류 설비 하이라이트
 * ---------------------------------------------------------------------------
 *  알람이 걸린 설비를 붉게 발광시킨다. 색을 통째로 바꾸면 어떤 설비인지
 *  알아보기 어려워지므로, 원래 색은 두고 emissive(자체 발광)만 얹어 맥동시킨다.
 *  머티리얼은 useAssembledModel 에서 이미 클론된 사본이라 다른 인스턴스에
 *  영향을 주지 않지만, 해제 시 원래 값으로 되돌려 놓는다.
 * ------------------------------------------------------------------------- */
function useFaultHighlight(object, active) {
  const meshes = useMemo(() => {
    const list = [];
    object.traverse((child) => {
      if (child.isMesh && child.material?.emissive) list.push(child);
    });
    return list;
  }, [object]);

  useEffect(() => {
    if (!active) return undefined;
    const saved = meshes.map((mesh) => ({
      mesh,
      emissive: mesh.material.emissive.clone(),
      intensity: mesh.material.emissiveIntensity ?? 1,
    }));
    return () => {
      saved.forEach(({ mesh, emissive, intensity }) => {
        mesh.material.emissive.copy(emissive);
        mesh.material.emissiveIntensity = intensity;
      });
    };
  }, [meshes, active]);

  useFrame(({ clock }) => {
    if (!active) return;
    const pulse = 0.3 + ((Math.sin(clock.elapsedTime * 4.5) + 1) / 2) * 0.7;
    meshes.forEach((mesh) => {
      mesh.material.emissive.setRGB(1, 0.05, 0.05);
      mesh.material.emissiveIntensity = pulse;
    });
  });
}

/* 선택 표시용 와이어프레임 박스 --------------------------------------------- */
function SelectionBox({ size, center, color }) {
  const edges = useMemo(() => {
    const geo = new THREE.BoxGeometry(size.x * 1.08, size.y * 1.08, size.z * 1.08);
    const e = new THREE.EdgesGeometry(geo);
    geo.dispose();
    return e;
  }, [size]);
  useEffect(() => () => edges.dispose(), [edges]);

  return (
    <lineSegments geometry={edges} position={center} renderOrder={999}>
      <lineBasicMaterial color={color} transparent opacity={0.95} depthTest={false} />
    </lineSegments>
  );
}

/* 바닥 상태 링 — 멀리서도 설비 상태를 식별하게 해준다 */
function StatusRing({ radius, center, color, pulse }) {
  const ref = useRef(null);
  useFrame(({ clock }) => {
    if (!ref.current || !pulse) return;
    const t = (Math.sin(clock.elapsedTime * 2.2) + 1) / 2;
    ref.current.material.opacity = 0.25 + t * 0.45;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[center.x, 0.02, center.z]}>
      <ringGeometry args={[radius, radius * 1.14, 48]} />
      <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} />
    </mesh>
  );
}

/* ---------------------------------------------------------------------------
 * 선택 가능한 설비
 * ------------------------------------------------------------------------- */
function SelectableModel({
  asset, offset, selected, onSelect, onMove, onDragChange, accentHex, clock,
  faulted = false, stopped = false, registerObject,
}) {
  const { object, size, center, animations } = useAssembledModel(asset.file);
  useProcessAnimation(object, animations, clock);
  useAlphaMapOverride(object, asset.alphaMaps);
  useFaultHighlight(object, faulted);
  const [hovered, setHovered] = useState(false);
  const [mounted, setMounted] = useState(false); // ref 가 채워진 뒤에야 기즈모를 붙일 수 있다
  const groupRef = useRef(null);
  /**
   * 바닥 링 색: 설비 오류 > 라인 비상 정지 > 마스터 상태 순으로 덮어쓴다.
   * 라인이 멈췄는데 초록 링이 맥동하고 있으면 화면이 거짓말을 하게 된다.
   */
  const status =
    (faulted ? STATUS.ERROR : stopped ? STATUS.STOPPED : STATUS[asset.status]) ?? STATUS.IDLE;
  const radius = Math.max(size.x, size.z) * 0.62;

  useEffect(() => setMounted(true), []);

  /* 알람 '설비로 이동' 이 카메라를 맞출 수 있도록 실제 3D 객체를 등록해 둔다 */
  useEffect(() => {
    if (!registerObject) return undefined;
    registerObject(asset.id, groupRef.current);
    return () => registerObject(asset.id, null);
  }, [registerObject, asset.id, mounted]);

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : 'auto';
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [hovered]);

  return (
    <>
      {/* 선택 시 객체 옆에 뜨는 이동 피벗(기즈모).
          드래그 중에는 OrbitControls 가 자동으로 잠깁니다(makeDefault 연동).
          상태 반영은 드래그가 끝날 때 한 번만 해서 프레임마다 리렌더되는 걸 막습니다.
          onMove 가 없으면(배치 조정 권한 없음) 기즈모 자체를 띄우지 않는다. */}
      {selected && mounted && Boolean(onMove) && (
        <TransformControls
          object={groupRef}
          mode="translate"
          size={0.75}
          onMouseDown={() => onDragChange(true)}
          onMouseUp={() => {
            const p = groupRef.current.position;
            onMove(asset.id, [
              +p.x.toFixed(2),
              +p.y.toFixed(2),
              +p.z.toFixed(2),
            ]);
            onDragChange(false);
          }}
        />
      )}

      <group
        ref={groupRef}
        position={offset}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(asset.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
      <primitive object={object} />

      <StatusRing radius={radius} center={center} color={status.hex} pulse={status.pulse} />

      {(selected || hovered) && (
        <SelectionBox size={size} center={center} color={selected ? accentHex : '#f8fafc'} />
      )}

      {(selected || hovered) && (
        <Html
          position={[center.x, size.y + 0.5, center.z]}
          center
          distanceFactor={10}
          zIndexRange={[10, 0]}
        >
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-white/20 bg-black/85 px-2 py-1 backdrop-blur-sm">
            <p className="text-[11px] font-semibold leading-none text-white">{asset.name}</p>
            <p className="mt-1 text-[9px] leading-none text-slate-400">
              {asset.nameKo} · {status.label}
            </p>
          </div>
        </Html>
      )}
      </group>
    </>
  );
}

/**
 * 선택 불가 구조물 — 핸들러가 없으므로 r3f 이벤트 대상에서 자동 제외된다.
 * 비활성 라인의 설비도 이걸로 그린다(opacity < 1 인 고스트).
 *  고스트일 때 알파맵 보정은 건너뛴다. 알파맵이 transparent/alphaTest 를 다시
 *  건드려서 균일한 반투명이 얼룩지기 때문이다.
 */
function StaticModel({ asset, offset, clock, opacity = 1 }) {
  const ghost = opacity < 1;
  const { object, animations } = useAssembledModel(asset.file, { transparent: ghost, opacity });
  useProcessAnimation(object, animations, clock);
  useAlphaMapOverride(object, ghost ? null : asset.alphaMaps);
  return (
    <group position={offset}>
      <primitive object={object} />
    </group>
  );
}

/**
 * 라인 1대 — FACTORY_ASSETS 한 벌을 라인 원점에 얹는다.
 *  활성 라인만 선택/기즈모가 살아 있고, 비활성 라인은 전부 고스트라
 *  핸들러가 없어 클릭을 가로채지 않는다.
 *
 *  [ 라인 원점을 group transform 으로 주지 않는 이유 ]
 *   drei 의 TransformControls 는 기즈모(`<primitive object={controls}>`)를
 *   자기가 놓인 부모 그룹의 자식으로 그리는데, 컨트롤 자신은 대상 객체의
 *   '월드' 좌표로 위치를 잡는다. 그래서 <group position={origin}> 안에 두면
 *   원점이 한 번 더 곱해져 기즈모만 라인 간격(10m)만큼 어긋난 자리에 뜬다.
 *   설비 좌표에 원점을 미리 더해 전부 월드 좌표에 놓으면 이 이중 적용이 사라진다.
 */
function LineGroup({
  line, active, selectedId, onSelect, onMove, onDragChange, accentHex, offsets, clock,
  faultedAssetId, stopped, registerObject,
}) {
  /* clock 은 이 라인 전용 시계다 — 비상 정지도 라인 단위로 걸린다 */
  const [ox, oy, oz] = line.origin;

  /* 기즈모가 돌려주는 값은 월드 좌표다. 저장값은 라인 원점을 뺀 '라인 기준 좌표'라
     라인마다 같은 기준으로 배치를 기록한다(배치 자체는 라인별로 따로 보관한다). */
  const handleMove = (id, [x, y, z]) =>
    onMove?.(id, [+(x - ox).toFixed(2), +(y - oy).toFixed(2), +(z - oz).toFixed(2)]);

  return (
    <>
      {FACTORY_ASSETS.map((asset) => {
        const [x, y, z] = offsets[asset.id] ?? asset.offset;
        const placed = [x + ox, y + oy, z + oz];
        return active && asset.selectable ? (
          <SelectableModel
            key={asset.id}
            asset={asset}
            offset={placed}
            selected={selectedId === asset.id}
            onSelect={onSelect}
            onMove={onMove ? handleMove : null}
            onDragChange={onDragChange}
            accentHex={accentHex}
            clock={clock}
            faulted={asset.id === faultedAssetId}
            stopped={stopped}
            registerObject={registerObject}
          />
        ) : (
          <StaticModel
            key={asset.id}
            asset={asset}
            offset={placed}
            clock={clock}
            opacity={active ? 1 : INACTIVE_LINE_OPACITY}
          />
        );
      })}
    </>
  );
}

/**
 * 공장 건물 셸 — 반투명 배경.
 * offset 으로 바닥 상면(Y=0.5)을 그리드(Y=0)에 맞춰 내린다.
 * opacity 1 일 때는 투명 처리를 끄고 불투명 재질로 렌더해 깊이 정렬을 정상화한다.
 */
function FactoryShell({ opacity }) {
  const opaque = opacity >= 0.995;
  const { object } = useAssembledModel(SHELL_ASSET.file, {
    transparent: !opaque,
    opacity,
  });

  /**
   * 셸을 투명 오브젝트 정렬에서 맨 앞(-1)으로 고정한다.
   *  셸(바닥 포함)과 그리드는 둘 다 투명 재질이라 three 가 매 프레임 카메라
   *  거리로 그리기 순서를 다시 정하는데, 둘의 거리가 엇비슷해 순서가 뒤바뀌면
   *  카메라를 돌 때마다 그리드가 보였다 안 보였다 한다. renderOrder 는 메시마다
   *  개별 적용이라 자식 전체를 순회해 지정한다.
   */
  useEffect(() => {
    object.traverse((child) => {
      if (child.isMesh) child.renderOrder = -1;
    });
  }, [object]);

  return <primitive object={object} position={SHELL_ASSET.offset} />;
}

/**
 * 공정 시각을 UI(React state)로 흘려보낸다.
 * 매 프레임 setState 하면 60fps 리렌더가 되므로 4Hz 로 솎아낸다.
 */
function ProcessTicker({ clock, onTick }) {
  const last = useRef(0);
  useFrame((state, delta) => {
    advanceProcessClock(clock, state, delta);
    if (!onTick) return;
    if (state.clock.elapsedTime - last.current < 0.25) return;
    last.current = state.clock.elapsedTime;
    onTick(clock.time);
  });
  return null;
}

/**
 * 라인을 바꾸면 카메라를 새 라인으로 옮긴다.
 *  홈 시점으로 리셋하지 않고 두 라인 원점의 '차이만큼' 카메라와 타깃을 함께
 *  평행이동한다. 사용자가 맞춰 둔 각도·줌은 그대로 두고 옆 라인으로 미끄러지듯
 *  넘어가므로, 시점이 초기화돼 방향을 잃는 일이 없다.
 */
function useLineCameraShift(controlsRef, origin, focusRequest) {
  const prevOrigin = useRef(origin);
  const prevFocus = useRef(focusRequest);
  const animRef = useRef(null);

  useEffect(() => {
    const from = prevOrigin.current;
    prevOrigin.current = origin;

    /* 같은 커밋에 focusRequest 도 함께 바뀌었다면 알람 '해당 설비로 이동' 흐름이다.
       그 경우 카메라는 FocusController 가 설비까지 끌고 가므로, 여기서 또
       애니메이션을 걸면 두 애니메이션이 매 프레임 서로 덮어쓰며 떨린다.
       예전처럼 즉시 평행이동만 해서 출발점을 잡아 준다. */
    const focusTookOver = prevFocus.current !== focusRequest;

    const controls = controlsRef?.current;
    if (!controls || !from || from === origin) return;

    const delta = new THREE.Vector3(origin[0] - from[0], origin[1] - from[1], origin[2] - from[2]);
    if (delta.lengthSq() === 0) return;

    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }

    if (focusTookOver) {
      controls.object.position.add(delta);
      controls.target.add(delta);
      controls.update();
      return;
    }

    /* 일반 라인 전환 — 0.9초 ease-in-out 무빙. 타깃도 같이 옮기므로
       도착한 뒤의 회전(OrbitControls)은 새 라인 중심을 기준으로 돈다. */
    const startPos = controls.object.position.clone();
    const startTgt = controls.target.clone();
    const endPos = startPos.clone().add(delta);
    const endTgt = startTgt.clone().add(delta);
    const DURATION_MS = 900;
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

    const step = (now) => {
      const k = Math.min(1, (now - t0) / DURATION_MS);
      const e = ease(k);
      controls.object.position.lerpVectors(startPos, endPos, e);
      controls.target.lerpVectors(startTgt, endTgt, e);
      controls.update();
      animRef.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    animRef.current = requestAnimationFrame(step);

    return () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
        /* 중간에 끊기면(라인 재전환·언마운트) 목적지로 스냅해 어긋남을 막는다 */
        controls.object.position.copy(endPos);
        controls.target.copy(endTgt);
        controls.update();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlsRef, origin]);

  /* 라인 전환 없이 focusRequest 만 바뀐 경우(같은 라인 내 알람)에도 최신값 유지 */
  useEffect(() => {
    prevFocus.current = focusRequest;
  }, [focusRequest]);
}

/**
 * 특정 설비로 카메라를 끌고 간다 (알람 → '해당 설비로 이동').
 *
 *  대상의 위치는 데이터가 아니라 실제 3D 객체의 바운딩 박스에서 구한다.
 *  설비마다 조립 좌표가 GLB 안에 구워져 있어 offset 만으로는 실제 중심을
 *  알 수 없기 때문이다. 크기에 비례해 거리를 잡아 큰 설비도 화면에 담는다.
 *
 *  라인을 전환하면서 요청이 오면 대상 설비가 아직 마운트되기 전일 수 있어,
 *  등록될 때까지 매 프레임 잠깐(2초) 재시도한다.
 */
function FocusController({ controlsRef, request, registry }) {
  const pending = useRef(null);
  const anim = useRef(null);

  useEffect(() => {
    if (!request) return;
    pending.current = { ...request, waited: 0 };
  }, [request]);

  useFrame((_, delta) => {
    const controls = controlsRef?.current;
    if (!controls) return;

    /* 1) 대상 해결 — 등록된 객체를 찾으면 이동 경로를 만든다 */
    const req = pending.current;
    if (req) {
      const object = registry.current[req.assetId];
      if (object) {
        pending.current = null;
        object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const radius = box.getSize(new THREE.Vector3()).length() * 0.5;
        const distance = Math.max(3.2, radius * 2.4);
        /* 비스듬히 내려다보는 각도를 유지한 채 접근한다 */
        const dir = new THREE.Vector3(0.85, 0.62, 0.85).normalize();
        anim.current = {
          t: 0,
          fromTarget: controls.target.clone(),
          toTarget: center,
          fromPos: controls.object.position.clone(),
          toPos: center.clone().add(dir.multiplyScalar(distance)),
        };
      } else {
        req.waited += delta;
        if (req.waited > 2) pending.current = null; // 못 찾으면 조용히 포기
      }
    }

    /* 2) 이동 — 0.9초 동안 부드럽게. 튀지 않게 ease-in-out 을 쓴다 */
    const a = anim.current;
    if (!a) return;
    a.t = Math.min(1, a.t + delta / 0.9);
    const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - ((-2 * a.t + 2) ** 2) / 2;
    controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
    controls.object.position.lerpVectors(a.fromPos, a.toPos, e);
    controls.update();
    if (a.t >= 1) anim.current = null;
  });

  return null;
}

/* 개발 모드 전용: 콘솔/E2E 에서 씬 검증용. 프로덕션 번들에는 포함되지 않음 */
function DebugBridge() {
  const state = useThree();
  useEffect(() => {
    window.__twin = state;
    return () => {
      delete window.__twin;
    };
  }, [state]);
  return null;
}

/* ---------------------------------------------------------------------------
 * 씬 내용물
 * ------------------------------------------------------------------------- */
function SceneContents({
  selectedId,
  onSelect,
  activeLineId,
  showGrid,
  showShell,
  shellOpacity,
  accentHex,
  gridCell,
  offsetsByLine,
  isLight,
  onMove,
  onDragChange,
  clocks,
  animByLine,
  faults,
  registerObject,
}) {
  return (
    <>
      {import.meta.env.DEV && <DebugBridge />}

      <hemisphereLight
        args={isLight ? ['#ffffff', '#cbd5e1', 2.0] : ['#dbeafe', '#0f172a', 1.1]}
        />
      <ambientLight intensity={isLight ? 0.9 : 0.55} />
      <directionalLight position={[12, 20, 8]} intensity={isLight ? 1.8 : 1.5} />
      <directionalLight
        position={[-14, 10, -10]}
        intensity={0.5}
        color={isLight ? '#e0f2fe' : '#93c5fd'}
      />

      {showGrid && (
        <Grid
          position={[0, GRID_LIFT, 0]}
          args={[80, 80]}
          cellSize={1}
          cellThickness={0.6}
          cellColor={gridCell}
          sectionSize={5}
          sectionThickness={1.2}
          sectionColor={accentHex}
          fadeDistance={55}
          fadeStrength={1.4}
          followCamera={false}
          infiniteGrid
        />
      )}

      {showShell && <FactoryShell opacity={shellOpacity} />}

      {PRODUCTION_LINES.map((line) => (
        <LineGroup
          key={line.id}
          line={line}
          active={line.id === activeLineId}
          selectedId={selectedId}
          onSelect={onSelect}
          onMove={onMove}
          onDragChange={onDragChange}
          accentHex={accentHex}
          offsets={offsetsByLine[line.id] ?? {}}
          clock={clocks[line.id]}
          faultedAssetId={faults?.[line.id] ?? null}
          stopped={Boolean(animByLine[line.id]?.paused)}
          registerObject={line.id === activeLineId ? registerObject : undefined}
        />
      ))}
    </>
  );
}

/* 로딩 오버레이 (Canvas 바깥 DOM) */
function LoadingOverlay({ accentHex, isLight }) {
  const { active, progress, item } = useProgress();
  if (!active) return null;
  return (
    <div
      className={`absolute inset-0 z-20 grid place-items-center backdrop-blur-sm ${
        isLight ? 'bg-white/70' : 'bg-black/70'
      }`}
    >
      <div className="w-64 text-center">
        <p className={`text-[11px] font-semibold tracking-widest ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
          LOADING 3D ASSETS
        </p>
        <div className={`mt-3 h-1.5 overflow-hidden rounded-full ${isLight ? 'bg-slate-300' : 'bg-white/10'}`}>
          <div
            className="h-full rounded-full transition-all duration-200"
            style={{ width: `${progress}%`, backgroundColor: accentHex }}
          />
        </div>
        <p className={`mt-2 truncate text-[10px] tabular-nums ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
          {Math.round(progress)}% · {String(item ?? '').split('/').pop()}
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 외부 공개 컴포넌트
 * ------------------------------------------------------------------------- */
export default function FactoryScene({
  selectedId,
  onSelect,
  activeLineId = PRODUCTION_LINES[0].id,
  showGrid = true,
  showShell = true,
  shellOpacity = 0.5,
  offsetsByLine = {},
  onMove,
  animByLine = {},
  onProcessTick,
  faults = {},
  focusRequest = null,
  theme,
  controlsRef,
}) {
  const isLight = theme.appearance === 'light';
  /* 기즈모 드래그로 끝난 포인터업이 '빈 공간 클릭'으로 오인돼 선택이 풀리는 것을 막는다 */
  const draggingRef = useRef(false);

  const activeLine = PRODUCTION_LINES.find((l) => l.id === activeLineId) ?? PRODUCTION_LINES[0];
  useLineCameraShift(controlsRef, activeLine.origin, focusRequest);

  /* 활성 라인 설비의 실제 3D 객체 — 알람에서 카메라를 맞출 때 쓴다 */
  const registry = useRef({});
  const registerObject = useCallback((assetId, object) => {
    if (object) registry.current[assetId] = object;
    else delete registry.current[assetId];
  }, []);

  /**
   * 라인별 공정 시계 (렌더를 유발하지 않고 매 프레임 갱신된다).
   * 배속과 정지 여부를 라인마다 따로 받으므로, 한 라인을 비상 정지해도
   * 다른 라인은 자기 속도로 계속 돌아간다.
   */
  const clocksRef = useRef(null);
  if (!clocksRef.current) {
    clocksRef.current = Object.fromEntries(
      PRODUCTION_LINES.map((l) => [l.id, { time: 0, stamp: -1, timeScale: 1, paused: false }])
    );
  }
  PRODUCTION_LINES.forEach((l) => {
    const clock = clocksRef.current[l.id];
    const anim = animByLine[l.id];
    clock.timeScale = anim?.timeScale ?? 1;
    clock.paused = Boolean(anim?.paused);
  });
  const activeClock = clocksRef.current[activeLineId] ?? clocksRef.current[PRODUCTION_LINES[0].id];

  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ position: CAMERA_HOME.position, fov: 45, near: 0.1, far: 500 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
        onPointerMissed={() => {
          if (!draggingRef.current) onSelect(null);
        }}
      >
        {/* 배경은 캔버스 뒤 DOM 의 CSS 그라데이션(theme.scene.bgGradient)이 비친다.
            fog 색을 그라데이션 중간 톤과 맞춰 원경이 자연스럽게 녹게 한다. */}
        <fog attach="fog" args={[theme.scene.fog, 35, 110]} />

        <Suspense fallback={null}>
          <SceneContents
            selectedId={selectedId}
            onSelect={onSelect}
            activeLineId={activeLineId}
            showGrid={showGrid}
            showShell={showShell}
            shellOpacity={shellOpacity}
            accentHex={theme.accentHex}
            gridCell={theme.scene.gridCell}
            offsetsByLine={offsetsByLine}
            isLight={isLight}
            onMove={onMove}
            onDragChange={(v) => {
              draggingRef.current = v;
            }}
            clocks={clocksRef.current}
            animByLine={animByLine}
            faults={faults}
            registerObject={registerObject}
          />
          {/* HUD 는 지금 보고 있는 라인의 공정 시각을 따라간다 */}
          <ProcessTicker clock={activeClock} onTick={onProcessTick} />
          {/* 설비 등록(자식 effect)이 끝난 뒤 요청을 처리하도록 라인들보다 뒤에 둔다 */}
          <FocusController controlsRef={controlsRef} request={focusRequest} registry={registry} />
        </Suspense>

        <OrbitControls
          ref={controlsRef}
          target={CAMERA_HOME.target}
          enableDamping
          dampingFactor={0.08}
          minDistance={2}
          maxDistance={60}
          maxPolarAngle={Math.PI / 2.05}
          makeDefault
        />
      </Canvas>

      <LoadingOverlay accentHex={theme.accentHex} isLight={isLight} />
    </div>
  );
}

/* 최초 인터랙션 전에 미리 받아두면 클릭 체감이 훨씬 좋아진다 */
[SHELL_ASSET, ...FACTORY_ASSETS].forEach((a) =>
  useGLTF.preload(assetUrl(a.file), assetUrl(DRACO_DECODER_PATH))
);

export { CAMERA_HOME };
