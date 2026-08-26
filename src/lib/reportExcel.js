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

export async function downloadReportWorkbook({
  production, events, lineStats, oeeByLine, simSnapshots = [], maintRows = [], maintLog = [],
}) {
  /* xlsx 는 내보내기를 실제로 누를 때만 내려받는다 */
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  /* 1) 생산 실적 */
  const prodRows = [
    ['완료 시각', '라인', '로트 번호', '품목', '수량(EA)', '불량(EA)', '계획(초)', '실적(초)', '달성률(%)'],
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

  /* 4) 시뮬레이션 스냅샷 */
  if (simSnapshots.length > 0) {
    const simRows = [
      ['저장 시각', '라인', '로트', '수량(EA)', 'P50 소요(초)', 'P90 소요(초)', '완료 예정(P50)', '예상 불량', '반출 실린더', '배속', '저장자'],
      ...simSnapshots.map((s) => [
        fmtIso(s.at),
        lineName(s.lineId),
        s.lots,
        s.totalQty,
        Math.round(s.p50Sec),
        Math.round(s.p90Sec),
        fmtIso(s.finishAtP50),
        s.defectsMean,
        s.cylinders,
        s.speed,
        s.user ?? '-',
      ]),
    ];
    const wsSim = XLSX.utils.aoa_to_sheet(simRows);
    wsSim['!cols'] = simRows[0].map(() => ({ wch: 14 }));
    XLSX.utils.book_append_sheet(wb, wsSim, '시뮬레이션 스냅샷');
  }

  /* 5) 설비 보전 — 소모품·점검 현황 + 교체 이력 */
  if (maintRows.length > 0) {
    const maintSheetRows = [
      ['라인', '설비', '시리얼', '소모품', '잔량(%)', '예상 잔여(EA)', '차기 점검', 'D-day'],
      ...maintRows.map((r) => [
        lineName(r.lineId), r.name, r.sn, r.label, r.percent, r.remainEa, r.nextCheck,
        r.dDay == null ? '' : r.dDay,
      ]),
    ];
    const wsMaint = XLSX.utils.aoa_to_sheet(maintSheetRows);
    wsMaint['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 9 }, { wch: 13 }, { wch: 12 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, wsMaint, '설비 보전');
  }
  if (maintLog.length > 0) {
    const replaceRows = [
      ['교체 시각', '라인', '설비', '소모품', '교체 전 잔량(%)', '작업자'],
      ...maintLog.map((m) => [
        fmtIso(m.at), lineName(m.lineId), m.name, m.label, Math.round(m.percentBefore), m.user ?? '-',
      ]),
    ];
    const wsReplace = XLSX.utils.aoa_to_sheet(replaceRows);
    wsReplace['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsReplace, '소모품 교체 이력');
  }

  /* 6) 전체 이벤트 로그 */
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
