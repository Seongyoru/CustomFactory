import { useCallback, useEffect, useRef } from 'react';
import { PRODUCTION_LINES } from '../data/factoryAssets.js';
import { usePersistentState, writeStore } from '../lib/persist.js';

/**
 * =============================================================================
 *  라인별 생산 엔진
 * =============================================================================
 *  기존 useLineJobTimers 는 선두 작업의 경과시간을 표준시간에서 '순환'만 시켰다.
 *  이 엔진은 작업을 실제로 완료시킨다:
 *
 *   - 경과시간이 표준시간에 도달하면 선두 작업이 완료되고 대기열이 전진한다.
 *     (완료 콜백으로 루트가 대기열·생산 이력을 갱신한다)
 *   - 실제 설비처럼 사이클마다 ±수 % 편차(jitter)를 줘서, 계획 대비 실적이
 *     100% 로 붙는 비현실적인 OEE 성능 지표를 피한다.
 *   - 라인별 누적 통계(가동시간·정지시간·생산량·불량)를 쌓는다 → OEE 산출 근거.
 *   - 경과시간·누적 통계는 localStorage 에 저장되어 새로고침해도 이어진다.
 *
 *  운전 모드는 1초에 1초, 시뮬레이션은 1초에 speed초 진행한다.
 *  보고 있지 않은 라인도 계속 진행한다 — 라인을 옮겨 다녀도 시간이 멈추지 않는다.
 * ---------------------------------------------------------------------------
 */

const emptyStats = () => ({ runSec: 0, downSec: 0, produced: 0, defects: 0, completedJobs: 0 });

const initialStats = () =>
  Object.fromEntries(PRODUCTION_LINES.map((l) => [l.id, emptyStats()]));

export function useProductionEngine({ jobsByLine, speed, pausedByLine, onJobComplete }) {
  const [elapsedByLine, setElapsedByLine] = usePersistentState('elapsedByLine', () =>
    Object.fromEntries(PRODUCTION_LINES.map((l) => [l.id, 451]))
  );
  const [lineStats, setLineStats] = usePersistentState('lineStats', initialStats);

  /* 인터벌 콜백이 항상 최신 대기열·정지상태·콜백을 보게 한다
     (deps 에 넣으면 작업을 고치거나 정지할 때마다 타이머가 끊긴다) */
  const jobsRef = useRef(jobsByLine);
  jobsRef.current = jobsByLine;
  const pausedRef = useRef(pausedByLine);
  pausedRef.current = pausedByLine;
  const completeRef = useRef(onJobComplete);
  completeRef.current = onJobComplete;

  /* 통계는 1초마다 갱신되므로 ref 에 쌓고 몇 초에 한 번만 state/저장소로 내보낸다.
     저장돼 있던 누적값에서 이어 쌓는다. */
  const statsRef = useRef(null);
  if (statsRef.current === null) {
    statsRef.current = Object.fromEntries(
      PRODUCTION_LINES.map((l) => [l.id, { ...emptyStats(), ...(lineStats[l.id] ?? {}) }])
    );
  }
  const flushCountRef = useRef(0);

  /* 현재 선두 작업에 실제로 쓴 시간(시뮬레이션 초) — 완료 시 실적 시간으로 기록 */
  const jobActualRef = useRef(null);
  if (jobActualRef.current === null) {
    jobActualRef.current = Object.fromEntries(
      PRODUCTION_LINES.map((l) => [l.id, elapsedByLine[l.id] ?? 0])
    );
  }

  /* 경과시간의 최신값 미러 — 틱 계산은 여기서 하고, state 는 결과만 받는다.
     setState 업데이터 안에서 통계·완료 콜백을 실행하면 StrictMode 가 업데이터를
     두 번 호출할 때 부수효과가 중복된다(같은 작업이 2번 완료되는 버그). */
  const elapsedRef = useRef(null);
  if (elapsedRef.current === null) elapsedRef.current = { ...elapsedByLine };

  useEffect(() => {
    const id = setInterval(() => {
      const stats = statsRef.current;
      const jobActual = jobActualRef.current;
      const prev = elapsedRef.current;
      const next = {};

      PRODUCTION_LINES.forEach((line) => {
        const cur = prev[line.id] ?? 0;

        /* 비상 정지된 라인 — 경과시간을 붙잡아 두고 정지시간만 쌓는다 */
        if (pausedRef.current[line.id]) {
          stats[line.id].downSec += speed;
          next[line.id] = cur;
          return;
        }

        const queue = jobsRef.current[line.id] ?? [];
        const head = queue[0] ?? null;

        /* 대기열이 비면 라인은 계획 유휴 상태 — 가동/정지 어느 쪽도 아니다 */
        if (!head || !(head.totalSec > 0)) {
          next[line.id] = 0;
          jobActual[line.id] = 0;
          return;
        }

        /* 사이클 편차: 공칭 대비 -6% ~ +2%. 계획(표준시간)보다 살짝 느리게
           도는 게 보통이라 OEE 성능 지표가 96~100% 부근에서 살아 움직인다. */
        const jitter = 0.96 + Math.random() * 0.06;
        const advanced = cur + speed * jitter;
        stats[line.id].runSec += speed;
        jobActual[line.id] += speed;

        if (advanced >= head.totalSec) {
          /* 작업 완료 — 초과분은 다음 작업으로 이월한다 (틱당 최대 1건 완료) */
          const actualSec = Math.round(jobActual[line.id]);
          const defects = Math.round(head.qty * Math.random() * 0.02); // 0~2% 불량
          stats[line.id].produced += head.qty;
          stats[line.id].defects += defects;
          stats[line.id].completedJobs += 1;
          const carry = advanced - head.totalSec;
          next[line.id] = carry;
          jobActual[line.id] = carry;
          completeRef.current?.(line.id, head, { actualSec, defects });
        } else {
          next[line.id] = advanced;
        }
      });

      elapsedRef.current = next;
      setElapsedByLine(next);

      /* 통계는 5초마다 한 번씩만 밖으로 내보낸다 */
      flushCountRef.current += 1;
      if (flushCountRef.current >= 5) {
        flushCountRef.current = 0;
        const snapshot = Object.fromEntries(
          PRODUCTION_LINES.map((l) => [l.id, { ...stats[l.id] }])
        );
        setLineStats(snapshot);
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  /** 선두 작업이 취소됐을 때 등 — 그 라인의 진행 시간을 0 부터 다시 센다 */
  const resetElapsed = useCallback((lineId) => {
    elapsedRef.current = { ...elapsedRef.current, [lineId]: 0 };
    setElapsedByLine((prev) => ({ ...prev, [lineId]: 0 }));
    if (jobActualRef.current) jobActualRef.current[lineId] = 0;
  }, [setElapsedByLine]);

  /** 누적 통계 초기화 (데모 리셋용) */
  const resetStats = useCallback(() => {
    statsRef.current = initialStats();
    setLineStats(initialStats());
    writeStore('lineStats', initialStats());
  }, [setLineStats]);

  return { elapsedByLine, lineStats, resetElapsed, resetStats };
}
