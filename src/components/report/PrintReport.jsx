/**
 * =============================================================================
 *  인쇄 전용 일일 생산·보전 보고서
 * =============================================================================
 *  화면에는 절대 보이지 않고(@media print 에서만 표시), 리포트 센터의 '인쇄'
 *  버튼이 window.print() 를 부르면 앱 대신 이 시트만 출력된다 — 브라우저의
 *  'PDF로 저장'이 곧 PDF 내보내기다. index.css 의 print 규칙과 짝을 이룬다.
 *
 *  종이는 테마가 없다 — 항상 흰 배경·검정 글자·회색 괘선으로 고정한다.
 *  body 포털: 모달 내부에 두면 #root 전체를 숨기는 인쇄 규칙에 같이 숨는다.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { PRODUCTION_LINES, findAsset } from '../../data/factoryAssets.js';
import { CONSUMABLE_WARN_PCT } from '../../lib/maintenance.js';
import { fmtClock, fmtDate, fmtDuration, fmtKoDuration } from '../../lib/format.js';
import { eventLabel } from '../../lib/events.js';

const lineName = (id) => PRODUCTION_LINES.find((l) => l.id === id)?.name ?? id ?? '-';
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

const S = {
  h2: { fontSize: '13px', fontWeight: 700, margin: '14px 0 6px', borderLeft: '3px solid #000', paddingLeft: '6px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '10px' },
  th: { border: '1px solid #bbb', background: '#f1f1f1', padding: '3px 6px', textAlign: 'left', fontWeight: 700 },
  td: { border: '1px solid #ccc', padding: '3px 6px' },
  muted: { color: '#555' },
};

const Th = ({ children }) => <th style={S.th}>{children}</th>;
const Td = ({ children, style }) => <td style={{ ...S.td, ...style }}>{children}</td>;

const PrintReport = ({ kpis, oeeByLine, lineStats, production, maintRows, maintKpis, maintLog, alarmEvents }) => {
  const now = new Date();
  const today = fmtDate(now);
  const todayProd = production.filter((p) => fmtDate(new Date(p.finishedAt)) === today);
  const todayAlarms = alarmEvents.filter((e) => fmtDate(new Date(e.at)) === today);

  return createPortal(
    <div className="print-sheet" style={{ color: '#000', background: '#fff', fontFamily: 'inherit' }}>
      {/* 표제 */}
      <div style={{ borderBottom: '2px solid #000', paddingBottom: '8px' }}>
        <p style={{ fontSize: '10px', letterSpacing: '0.2em', fontWeight: 700 }}>EGIS FACTORY · DIGITAL TWIN</p>
        <h1 style={{ fontSize: '18px', fontWeight: 800, margin: '2px 0' }}>일일 생산·보전 보고서</h1>
        <p style={{ fontSize: '10px', ...S.muted }}>
          기준 시각 {today} {fmtClock(now)} · 시뮬레이션 데이터 기반 데모 보고서
        </p>
      </div>

      {/* 금일 KPI */}
      <h2 style={S.h2}>금일 요약</h2>
      <table style={S.table}>
        <tbody>
          <tr>
            {[
              ['생산량', todayProd.reduce((a, p) => a + p.qty, 0) + ' EA'],
              ['완료 로트', todayProd.length + '건'],
              ['불량', todayProd.reduce((a, p) => a + p.defects, 0) + ' EA'],
              ['계획 달성률', pct(kpis.achieve)],
              ['금일 알람', kpis.alarms + '건'],
            ].map(([k, v]) => (
              <Td key={k}>
                <span style={S.muted}>{k}</span>{' '}
                <b style={{ fontSize: '12px' }}>{v}</b>
              </Td>
            ))}
          </tr>
        </tbody>
      </table>

      {/* 라인 OEE */}
      <h2 style={S.h2}>라인별 가동 실적 (누적)</h2>
      <table style={S.table}>
        <thead>
          <tr>
            {['라인', '가동시간', '정지시간', '생산량', '불량', '가동률', '성능', '품질', 'OEE'].map((h) => <Th key={h}>{h}</Th>)}
          </tr>
        </thead>
        <tbody>
          {PRODUCTION_LINES.map((l) => {
            const s = lineStats[l.id] ?? {};
            const o = oeeByLine[l.id] ?? {};
            return (
              <tr key={l.id}>
                <Td>{l.name}</Td>
                <Td>{fmtDuration(s.runSec ?? 0)}</Td>
                <Td>{fmtDuration(s.downSec ?? 0)}</Td>
                <Td>{(s.produced ?? 0) + ' EA'}</Td>
                <Td>{(s.defects ?? 0) + ' EA'}</Td>
                <Td>{pct(o.availability)}</Td>
                <Td>{pct(o.performance)}</Td>
                <Td>{pct(o.quality)}</Td>
                <Td style={{ fontWeight: 700 }}>{pct(o.oee)}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* 금일 완료 로트 */}
      <h2 style={S.h2}>금일 완료 로트 ({todayProd.length}건)</h2>
      <table style={S.table}>
        <thead>
          <tr>{['완료 시각', '라인', '품목', '수량', '불량', '계획', '실적'].map((h) => <Th key={h}>{h}</Th>)}</tr>
        </thead>
        <tbody>
          {todayProd.length === 0 && (
            <tr><Td style={{ textAlign: 'center', ...S.muted }} colSpan={7}>완료된 로트가 없습니다.</Td></tr>
          )}
          {todayProd.slice(0, 20).map((p) => (
            <tr key={p.id}>
              <Td>{fmtClock(new Date(p.finishedAt))}</Td>
              <Td>{lineName(p.lineId)}</Td>
              <Td>{p.name}</Td>
              <Td>{p.qty} EA</Td>
              <Td>{p.defects} EA</Td>
              <Td>{fmtDuration(p.plannedSec)}</Td>
              <Td>{fmtDuration(p.actualSec)}</Td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 설비 보전 현황 */}
      <h2 style={S.h2}>설비 보전 현황</h2>
      <table style={S.table}>
        <thead>
          <tr>{['라인', '설비', '소모품', '잔량', '예상 잔여', '차기 점검'].map((h) => <Th key={h}>{h}</Th>)}</tr>
        </thead>
        <tbody>
          {maintRows.map((r) => (
            <tr key={`${r.lineId}:${r.assetId}`}>
              <Td>{lineName(r.lineId)}</Td>
              <Td>{r.name}</Td>
              <Td>{r.label}</Td>
              <Td style={r.percent <= CONSUMABLE_WARN_PCT ? { fontWeight: 700 } : undefined}>
                {r.percent}%{r.percent <= CONSUMABLE_WARN_PCT ? ' ⚠' : ''}
              </Td>
              <Td>{r.remainEa} EA</Td>
              <Td>{r.nextCheck}{r.dDay != null ? ` (${r.dDay < 0 ? `${-r.dDay}일 지남` : `D-${r.dDay}`})` : ''}</Td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 보전 지표 */}
      {maintKpis.length > 0 && (
        <>
          <h2 style={S.h2}>보전 지표 (알람 기준 · 이벤트 로그 보관분)</h2>
          <table style={S.table}>
            <thead>
              <tr>{['라인', '설비', '발생', 'MTTA', 'MTTR', 'MTBF', '현재'].map((h) => <Th key={h}>{h}</Th>)}</tr>
            </thead>
            <tbody>
              {maintKpis.map((k) => (
                <tr key={`${k.lineId}:${k.assetId}`}>
                  <Td>{lineName(k.lineId)}</Td>
                  <Td>{findAsset(k.assetId)?.nameKo ?? k.assetId}</Td>
                  <Td>{k.occurrences}건</Td>
                  <Td>{k.mttaSec == null ? '—' : fmtKoDuration(Math.round(k.mttaSec))}</Td>
                  <Td>{k.mttrSec == null ? '—' : fmtKoDuration(Math.round(k.mttrSec))}</Td>
                  <Td>{k.mtbfSec == null ? '—' : fmtKoDuration(Math.round(k.mtbfSec))}</Td>
                  <Td>{k.openSince ? `조치 중 (${fmtClock(k.openSince)}~)` : '정상'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* 금일 알람 이력 */}
      <h2 style={S.h2}>금일 알람·정지 이력 ({todayAlarms.length}건)</h2>
      <table style={S.table}>
        <thead>
          <tr>{['시각', '구분', '라인', '내용'].map((h) => <Th key={h}>{h}</Th>)}</tr>
        </thead>
        <tbody>
          {todayAlarms.length === 0 && (
            <tr><Td style={{ textAlign: 'center', ...S.muted }} colSpan={4}>금일 알람이 없습니다.</Td></tr>
          )}
          {todayAlarms.slice(0, 30).map((e) => (
            <tr key={e.id}>
              <Td>{fmtClock(new Date(e.at))}</Td>
              <Td>{eventLabel(e.type)}</Td>
              <Td>{lineName(e.lineId)}</Td>
              <Td>{e.message}</Td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 소모품 교체 이력 (최근) */}
      {maintLog.length > 0 && (
        <>
          <h2 style={S.h2}>소모품 교체 이력 (최근 {Math.min(10, maintLog.length)}건)</h2>
          <table style={S.table}>
            <thead>
              <tr>{['교체 시각', '라인', '설비', '소모품', '교체 전 잔량', '작업자'].map((h) => <Th key={h}>{h}</Th>)}</tr>
            </thead>
            <tbody>
              {maintLog.slice(0, 10).map((m) => (
                <tr key={m.id}>
                  <Td>{fmtDate(new Date(m.at))} {fmtClock(new Date(m.at))}</Td>
                  <Td>{lineName(m.lineId)}</Td>
                  <Td>{m.name}</Td>
                  <Td>{m.label}</Td>
                  <Td>{Math.round(m.percentBefore)}% → 100%</Td>
                  <Td>{m.user ?? '-'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p style={{ marginTop: '12px', fontSize: '9px', ...S.muted }}>
        본 보고서는 EGIS Factory 디지털 트윈이 자동 생성했습니다. 수치는 시뮬레이션 기반이며
        실설비 연동 시 동일 양식으로 실측치가 출력됩니다.
      </p>
    </div>,
    document.body
  );
};

export default PrintReport;
