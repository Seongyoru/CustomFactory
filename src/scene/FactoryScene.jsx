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

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls, TransformControls, useGLTF, useProgress } from '@react-three/drei';
import * as THREE from 'three';
import { FACTORY_ASSETS, SHELL_ASSET, STATUS } from '../data/factoryAssets.js';

/* 설비 셀이 4.5×3.2×6.9m 규모라 카메라도 가깝게 잡는다 */
const CAMERA_HOME = { position: [8.5, 5.2, 9.5], target: [0.4, 1.3, 0] };

/* ---------------------------------------------------------------------------
 * GLB 를 원본 좌표 그대로 복제한다.
 * useGLTF 는 URL 별로 동일 인스턴스를 캐시하므로 반드시 clone 해서 쓴다.
 * ------------------------------------------------------------------------- */
function useAssembledModel(url, { transparent = false, opacity = 1 } = {}) {
  const { scene } = useGLTF(url);

  return useMemo(() => {
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
      child.material.side = THREE.DoubleSide;
      if (transparent) {
        child.material.transparent = true;
        child.material.opacity = opacity;
        child.material.depthWrite = false;
      }
    });

    return { object, size, center };
  }, [scene, transparent, opacity]);
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
function SelectableModel({ asset, offset, selected, onSelect, onMove, onDragChange, accentHex }) {
  const { object, size, center } = useAssembledModel(asset.file);
  const [hovered, setHovered] = useState(false);
  const [mounted, setMounted] = useState(false); // ref 가 채워진 뒤에야 기즈모를 붙일 수 있다
  const groupRef = useRef(null);
  const status = STATUS[asset.status] ?? STATUS.IDLE;
  const radius = Math.max(size.x, size.z) * 0.62;

  useEffect(() => setMounted(true), []);

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
          상태 반영은 드래그가 끝날 때 한 번만 해서 프레임마다 리렌더되는 걸 막습니다. */}
      {selected && mounted && (
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

/* 선택 불가 구조물 — 핸들러가 없으므로 r3f 이벤트 대상에서 자동 제외된다 */
function StaticModel({ asset, offset }) {
  const { object } = useAssembledModel(asset.file);
  return (
    <group position={offset}>
      <primitive object={object} />
    </group>
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
  return <primitive object={object} position={SHELL_ASSET.offset} />;
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
  showGrid,
  showShell,
  shellOpacity,
  accentHex,
  gridCell,
  offsets,
  isLight,
  onMove,
  onDragChange,
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

      {FACTORY_ASSETS.map((asset) => {
        const offset = offsets[asset.id] ?? asset.offset;
        return asset.selectable ? (
          <SelectableModel
            key={asset.id}
            asset={asset}
            offset={offset}
            selected={selectedId === asset.id}
            onSelect={onSelect}
            onMove={onMove}
            onDragChange={onDragChange}
            accentHex={accentHex}
          />
        ) : (
          <StaticModel key={asset.id} asset={asset} offset={offset} />
        );
      })}
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
  showGrid = true,
  showShell = true,
  shellOpacity = 0.5,
  offsets = {},
  onMove,
  theme,
  controlsRef,
}) {
  const isLight = theme.appearance === 'light';
  /* 기즈모 드래그로 끝난 포인터업이 '빈 공간 클릭'으로 오인돼 선택이 풀리는 것을 막는다 */
  const draggingRef = useRef(false);

  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ position: CAMERA_HOME.position, fov: 45, near: 0.1, far: 500 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => {
          if (!draggingRef.current) onSelect(null);
        }}
      >
        <color attach="background" args={[theme.scene.bg]} />
        <fog attach="fog" args={[theme.scene.fog, 35, 110]} />

        <Suspense fallback={null}>
          <SceneContents
            selectedId={selectedId}
            onSelect={onSelect}
            showGrid={showGrid}
            showShell={showShell}
            shellOpacity={shellOpacity}
            accentHex={theme.accentHex}
            gridCell={theme.scene.gridCell}
            offsets={offsets}
            isLight={isLight}
            onMove={onMove}
            onDragChange={(v) => {
              draggingRef.current = v;
            }}
          />
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
[SHELL_ASSET, ...FACTORY_ASSETS].forEach((a) => useGLTF.preload(a.file));

export { CAMERA_HOME };
