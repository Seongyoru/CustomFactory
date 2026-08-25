/**
 * =============================================================================
 *  리포트 엑셀 내보내기 — 생산 실적 / 알람 이력 / 이벤트 로그 3개 시트
 * =============================================================================
 */
import { PRODUCTION_LINES } from '../data/factoryAssets.js';
import { eventLabel } from './events.js';

const lineName = (id) => PRODUCTION_LINES.find((l) => l.id === id)?.name ?? id ?? '-';
const fmtIso = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export async function downloadReportWorkbook({ production, events, lineStats, oeeByLine }) {
  /* xlsx 는 내보내기를 실제로 누를 때만 내려받는다 */
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  /* 1) 생산 실적 */
  const prodRows = [
    ['완료 시각', '라인', '지시 번호', '작업명', '수량(EA)', '불량(EA)', '계획(초)', '실적(초)', '달성률(%)'],
    ...production.map((p) => [
      fmtIso(p.finishedAt),
      lineName(p.lineId),
      p.jobId,
      p.name,
      p.qty,
      p.defects,
      p.plannedSec,
      p.actualSec,
      p.actualSec > 0 ? Math.round((p.plannedSec / p.actualSec) * 100) : '',
    ]),
  ];
  const wsProd = XLSX.utils.aoa_to_sheet(prodRows);
  wsProd['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 26 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsProd, '생산 실적');

  /* 2) 라인 요약 (OEE) */
  const summaryRows = [
    ['라인', '가동시간(초)', '정지시간(초)', '생산량(EA)', '불량(EA)', '완료 작업', '가동률(%)', '성능(%)', '품질(%)', 'OEE(%)'],
    ...PRODUCTION_LINES.map((l) => {
      const s = lineStats[l.id] ?? {};
      const o = oeeByLine[l.id] ?? {};
      const pct = (v) => (v == null ? '' : Math.round(v * 100));
      return [
        lineName(l.id), s.runSec ?? 0, s.downSec ?? 0, s.produced ?? 0, s.defects ?? 0, s.completedJobs ?? 0,
        pct(o.availability), pct(o.performance), pct(o.quality), pct(o.oee),
      ];
    }),
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = summaryRows[0].map(() => ({ wch: 13 }));
  XLSX.utils.book_append_sheet(wb, wsSummary, '라인 요약');

  /* 3) 알람 이력 */
  const alarmRows = [
    ['발생 시각', '구분', '라인', '내용'],
    ...events
      .filter((e) => e.type.startsWith('ALARM_') || e.type.startsWith('ESTOP_'))
      .map((e) => [fmtIso(e.at), eventLabel(e.type), lineName(e.lineId), e.message]),
  ];
  const wsAlarm = XLSX.utils.aoa_to_sheet(alarmRows);
  wsAlarm['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsAlarm, '알람 이력');

  /* 4) 전체 이벤트 로그 */
  const eventRows = [
    ['시각', '구분', '라인', '내용'],
    ...events.map((e) => [fmtIso(e.at), eventLabel(e.type), lineName(e.lineId), e.message]),
  ];
  const wsEvents = XLSX.utils.aoa_to_sheet(eventRows);
  wsEvents['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsEvents, '이벤트 로그');

  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  XLSX.writeFile(wb, `EGIS_생산리포트_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`);
}
