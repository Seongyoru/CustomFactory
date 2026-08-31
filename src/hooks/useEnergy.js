/**
 * =============================================================================
 *  에너지 적산 훅 — 텔레메트리 전류에서 라인별 금일 kWh 를 쌓는다
 * =============================================================================
 *  순간 전력(kW)은 latest 에서 즉시 유도되지만(대시보드 useMemo), 누적 kWh 는
 *  시간 적분이 필요해 여기서 관리한다:
 *   - 걸음 적분: 마지막 표본 시각과의 dt 로 kW·dt 를 더한다 (비정상 dt 는 버림 —
 *     lib/energy.integrateKwh)
 *   - 날짜가 바뀌면 0 부터 다시 (금일 지표)
 *   - 적산은 ref 에 쌓고 10초에 한 번만 state/저장소로 내보낸다 (엔진 통계와 동일 패턴,
 *     StrictMode 이중 실행에도 부수효과가 중복되지 않는다)
 */
import { useEffect, useRef } from 'react';
import { PRODUCTION_LINES } from '../data/factoryAssets.js';
import { integrateKwh, linePowerKw } from '../lib/energy.js';
import { usePersistentState } from '../lib/persist.js';
import { fmtDate } from '../lib/format.js';

const emptyDay = (date) => ({
  date,
  ...Object.fromEntries(PRODUCTION_LINES.map((l) => [l.id, 0])),
});

export function useEnergy({ latest }) {
  const [kwhToday, setKwhToday] = usePersistentState(
    'energyKwh',
    () => emptyDay(fmtDate(new Date())),
    /* 어제 저장분은 로드 시점에 버린다 — '금일' 지표가 어제 값으로 시작하지 않게 */
    (stored) => (stored?.date === fmtDate(new Date()) ? stored : emptyDay(fmtDate(new Date())))
  );

  const accRef = useRef(null);
  if (accRef.current === null) accRef.current = { ...kwhToday };
  const lastAtRef = useRef(0);
  const flushCountRef = useRef(0);

  useEffect(() => {
    if (!latest || Object.keys(latest).length === 0) return;
    const now = Date.now();
    const dt = lastAtRef.current > 0 ? now - lastAtRef.current : 0;
    lastAtRef.current = now;

    const acc = accRef.current;
    const today = fmtDate(new Date());
    if (acc.date !== today) {
      /* 자정 롤오버 — 금일 지표는 0 부터 */
      Object.assign(acc, emptyDay(today));
    }
    for (const line of PRODUCTION_LINES) {
      /* 이 프레임에 없는 라인은 '0kW 실측'이 아니라 '데이터 없음' — 적산하지 않는다
         (게이트웨이가 라인을 나눠 보내는 부분 프레임에서 kWh 가 깎이지 않게) */
      if (!latest[line.id]) continue;
      acc[line.id] = (acc[line.id] ?? 0) + integrateKwh(linePowerKw(latest[line.id]), dt);
    }

    flushCountRef.current += 1;
    if (flushCountRef.current >= 10) {
      flushCountRef.current = 0;
      setKwhToday({ ...acc });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  /* 표시용 — 마지막 플러시본이면 충분하다 (10초 지연은 kWh 단위에서 티가 안 난다).
     탭을 켠 채 자정을 넘겼는데 텔레메트리가 멎어 롤오버 효과가 못 도는 경우까지
     막기 위해, 내보내는 값도 날짜를 한 번 더 검사한다 (대시보드는 1Hz 리렌더). */
  const today = fmtDate(new Date());
  return { kwhByLine: kwhToday.date === today ? kwhToday : emptyDay(today) };
}
