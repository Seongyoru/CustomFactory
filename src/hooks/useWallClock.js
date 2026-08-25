import { useEffect, useState } from 'react';

/** 1초마다 갱신되는 벽시계 */
export function useWallClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
