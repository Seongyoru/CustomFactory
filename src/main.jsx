import React from 'react';
import { createRoot } from 'react-dom/client';
import DigitalTwinDashboard from './DigitalTwinDashboard.jsx';
import { hydrateFromRemote } from './lib/persist.js';
import './index.css';

/**
 * 서버 저장소가 설정돼 있으면 스냅샷을 localStorage 에 선주입한 뒤에 앱을 띄운다.
 * 화면 코드는 동기 localStorage 만 보므로 이 한 번의 대기가 원격 저장의 전부다.
 * 서버가 없거나 죽었으면(3초 제한) 로컬 데이터로 그대로 시작한다.
 */
const boot = async () => {
  const hydrated = await hydrateFromRemote();
  if (hydrated.mode === 'remote') {
    console.info(`[persist] 서버 저장소에서 ${hydrated.count}개 키 선주입 (rev ${hydrated.rev})`);
  } else if (hydrated.mode === 'offline') {
    console.warn(`[persist] 서버 저장소 연결 실패 — 로컬 데이터로 시작: ${hydrated.error}`);
  }
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <DigitalTwinDashboard />
    </React.StrictMode>
  );
};

boot();
