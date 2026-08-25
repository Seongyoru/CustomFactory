/**
 * =============================================================================
 *  실시간 센서 패널 — 설비 상세 사이드바 내 온도/진동/전류 라이브 차트
 * =============================================================================
 *  1Hz 텔레메트리의 최근 2분 창을 스파크라인으로 보여준다.
 *  - 단일 시리즈라 범례는 없고, 현재값을 행 우측에 직접 표기한다
 *  - 값 텍스트는 본문 토큰을 쓰고, 상태(정상/주의/위험)는 점·선 색으로만 얹는다
 *  - 데이터 소스가 시뮬레이션인지 실계측인지 헤더 칩으로 명시한다
 * ---------------------------------------------------------------------------
 */
import React from 'react';
import { Radio } from 'lucide-react';
import { TELEMETRY_METRICS, metricStatus } from '../../telemetry/simulatedSource.js';
import { Panel, PanelTitle } from '../ui.jsx';

const STATUS_HEX = { ok: null, warn: '#f59e0b', crit: '#ef4444' };
const STATUS_LABEL = { ok: '정상', warn: '주의', crit: '위험' };

/** 폭에 맞춰 늘어나는 미니 라인차트 (마지막 값에 점 하나) */
const Sparkline = ({ values, stroke, height = 30 }) => {
  const W = 100; // viewBox 기준 폭 — preserveAspectRatio="none" 으로 늘린다
  const H = 30;
  if (values.length < 2) {
    return <div style={{ height }} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = span * 0.15;
  const lo = min - pad;
  const hi = max + pad;
  const x = (i) => (i / (values.length - 1)) * W;
  const y = (v) => H - ((v - lo) / (hi - lo)) * H;
  const points = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r="2.4" fill={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

const TelemetryPanel = ({ theme, lineId, assetId, latest, seriesOf, sourceInfo }) => {
  const current = latest?.[lineId]?.[assetId] ?? null;

  return (
    <Panel theme={theme}>
      <PanelTitle
        icon={Radio}
        title="실시간 센서"
        theme={theme}
        hint="1초 간격의 시뮬레이션 계측값입니다. 정지한 라인은 식어가고, 오류 설비는 진동·전류가 치솟습니다. 실제 연동 시 OPC-UA 값이 같은 화면에 흐릅니다."
        right={
          <span className={`text-[10px] px-2 py-0.5 rounded border ${theme.chip}`}>
            {sourceInfo?.protocol ?? 'SIM'} · 1Hz
          </span>
        }
      />
      <div className="p-3 space-y-3">
        {TELEMETRY_METRICS.map(({ key, label, unit, digits }) => {
          const value = current?.[key];
          const series = seriesOf(lineId, assetId, key);
          const status = value != null ? metricStatus(assetId, key, value) : 'ok';
          const strokeHex = STATUS_HEX[status] ?? theme.accentHex;
          return (
            <div key={key}>
              <div className="flex items-baseline justify-between">
                <span className={`text-[11px] ${theme.textMuted}`}>{label}</span>
                <span className="flex items-baseline gap-1.5">
                  {status !== 'ok' && (
                    <span
                      className="text-[9px] font-bold px-1 py-0.5 rounded"
                      style={{ color: strokeHex, backgroundColor: `${strokeHex}1a` }}
                    >
                      {STATUS_LABEL[status]}
                    </span>
                  )}
                  <span className={`text-[13px] font-bold tabular-nums ${theme.textPrimary}`}>
                    {value != null ? value.toFixed(digits) : '--'}
                  </span>
                  <span className={`text-[10px] ${theme.textFaint}`}>{unit}</span>
                </span>
              </div>
              <div className={`mt-1 rounded-md border ${theme.panelBorder} ${theme.subtleBg} px-1.5 py-1`}>
                <Sparkline values={series} stroke={strokeHex} />
              </div>
            </div>
          );
        })}
        <p className={`text-[9px] ${theme.textGhost}`}>최근 2분 · 1초 간격 표본</p>
      </div>
    </Panel>
  );
};

export default TelemetryPanel;
