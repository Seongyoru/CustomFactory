/**
 * 엑셀 업로드 모달
 *   업로드 → 검증 → 미리보기 → 확정. 파일을 바로 대기열에 밀어넣지 않고
 *   행별 검증 결과를 먼저 보여준 뒤 사용자가 선택한 행만 반영한다.
 */
import React, { useRef, useState } from 'react';
import { FileDown, Upload, X } from 'lucide-react';
import {
  OPTIONAL_COLUMNS, REQUIRED_COLUMNS, downloadJobTemplate, parseJobWorkbook,
} from '../../lib/jobExcel.js';
import { GhostButton, Modal } from '../ui.jsx';

const ExcelUploadModal = ({ theme, existingNames, onImport, onClose }) => {
  const [state, setState] = useState({ status: 'idle' }); // idle | parsing | done | error
  const [checked, setChecked] = useState(new Set());
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setState({ status: 'parsing', fileName: file.name });
    try {
      const result = await parseJobWorkbook(file, existingNames);
      setState({ status: 'done', fileName: file.name, ...result });
      setChecked(new Set(result.rows.filter((r) => r.valid).map((r) => r.excelRow)));
    } catch (e) {
      setState({ status: 'error', fileName: file.name, message: e?.message ?? '파일을 읽을 수 없습니다.' });
    }
  };

  const rows = state.rows ?? [];
  const validCount = rows.filter((r) => r.valid).length;
  const errorCount = rows.length - validCount;
  const selected = rows.filter((r) => checked.has(r.excelRow));

  const toggle = (row) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(row.excelRow)) next.delete(row.excelRow);
      else next.add(row.excelRow);
      return next;
    });

  return (
    <Modal theme={theme} onClose={onClose} className="w-[780px]">
      <header className={`flex items-center justify-between px-5 py-3.5 border-b ${theme.panelBorder} ${theme.accentBgSoft}`}>
        <div className="flex items-center gap-2">
          <Upload className={`w-4 h-4 ${theme.accentText}`} />
          <h3 className={`text-sm font-bold ${theme.textPrimary}`}>엑셀 업로드</h3>
          {state.sheetName && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] border ${theme.chip}`}>시트: {state.sheetName}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <GhostButton icon={FileDown} theme={theme} onClick={downloadJobTemplate} className="px-2">
            양식 다운로드
          </GhostButton>
          <button type="button" onClick={onClose} className={`grid place-items-center w-7 h-7 rounded-md ${theme.textMuted} ${theme.hoverBg}`} aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="max-h-[70vh] overflow-y-auto p-5 space-y-4">
        {/* 드롭존 */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
          onClick={() => inputRef.current?.click()}
          className={`grid place-items-center h-28 rounded-xl border-2 border-dashed cursor-pointer transition-colors
            ${dragOver ? theme.accentBgSoft : theme.subtleBg} ${theme.panelBorder}`}
          style={dragOver ? { borderColor: theme.accentHex } : undefined}
        >
          <div className="text-center">
            <Upload className={`w-6 h-6 mx-auto ${theme.accentText}`} />
            <p className={`mt-2 text-[12px] font-medium ${theme.textPrimary}`}>
              {state.fileName ?? '엑셀 파일을 여기에 놓거나 클릭해서 선택'}
            </p>
            <p className={`mt-0.5 text-[10px] ${theme.textFaint}`}>.xlsx · .xls · .csv</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>

        {/* 필요한 컬럼 안내 */}
        <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2 text-[11px]`}>
          <span className={theme.textMuted}>필수 컬럼 </span>
          <span className={`font-semibold ${theme.textPrimary}`}>{REQUIRED_COLUMNS.join(' · ')}</span>
          <span className={`ml-3 ${theme.textMuted}`}>선택 </span>
          <span className={theme.textSecondary}>{OPTIONAL_COLUMNS.join(' · ')}</span>
        </div>

        {state.status === 'error' && (
          <p className="text-[12px] text-red-500">파일을 읽지 못했습니다 — {state.message}</p>
        )}

        {state.status === 'done' && state.missingRequired?.length > 0 && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5">
            <p className="text-[12px] font-semibold text-red-500">필수 컬럼을 찾지 못했습니다</p>
            <p className={`mt-1 text-[11px] ${theme.textSecondary}`}>
              누락: {state.missingRequired.join(', ')}
              {state.unmatched?.length > 0 && ` · 인식되지 않은 헤더: ${state.unmatched.slice(0, 6).join(', ')}`}
            </p>
            <p className={`mt-1 text-[10px] ${theme.textFaint}`}>
              양식 다운로드로 받은 파일의 헤더명을 사용하면 확실합니다.
            </p>
          </div>
        )}

        {/* 미리보기 */}
        {state.status === 'done' && rows.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className={`text-[11px] font-bold tracking-wider ${theme.textMuted}`}>
                미리보기 · 총 {rows.length}행
                <span className="ml-2 text-emerald-500">정상 {validCount}</span>
                {errorCount > 0 && <span className="ml-2 text-red-500">오류 {errorCount}</span>}
              </h4>
              <button
                type="button"
                onClick={() =>
                  setChecked((prev) =>
                    prev.size === validCount ? new Set() : new Set(rows.filter((r) => r.valid).map((r) => r.excelRow))
                  )
                }
                className={`text-[10px] ${theme.textMuted} hover:underline`}
              >
                정상 행 전체 {checked.size === validCount ? '해제' : '선택'}
              </button>
            </div>

            <div className={`rounded-lg border ${theme.panelBorder} overflow-hidden`}>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className={`sticky top-0 ${theme.headerBg}`}>
                    <tr className={`border-b ${theme.divider}`}>
                      {['', '행', '작업명', '수량', '표준시간', '설비', '검증'].map((h) => (
                        <th key={h} className={`px-2 py-1.5 text-left font-semibold ${theme.textMuted}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.excelRow}
                        className={`border-b last:border-0 ${theme.divider} ${r.valid ? '' : 'bg-red-500/5'}`}
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={checked.has(r.excelRow)}
                            disabled={!r.valid}
                            onChange={() => toggle(r)}
                            className="accent-sky-500 disabled:opacity-30"
                          />
                        </td>
                        <td className={`px-2 py-1.5 tabular-nums ${theme.textFaint}`}>{r.excelRow}</td>
                        <td className={`px-2 py-1.5 ${theme.textPrimary}`}>{r.name || <span className="text-red-500">—</span>}</td>
                        <td className={`px-2 py-1.5 tabular-nums ${theme.textSecondary}`}>{r.qty || '—'}</td>
                        <td className={`px-2 py-1.5 tabular-nums ${theme.textSecondary}`}>{r.minutes ? `${r.minutes}분` : '—'}</td>
                        <td className={`px-2 py-1.5 ${theme.textFaint}`}>{r.equipment || '—'}</td>
                        <td className="px-2 py-1.5">
                          {r.valid
                            ? <span className="text-emerald-500">정상</span>
                            : <span className="text-red-500">{r.errors.join(', ')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>

      <footer className={`flex items-center justify-between px-5 py-3 border-t ${theme.panelBorder} ${theme.subtleBg}`}>
        <span className={`text-[11px] ${theme.textMuted}`}>
          {selected.length > 0 ? `${selected.length}개 작업이 대기열에 추가됩니다.` : '추가할 행을 선택하세요.'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`h-9 px-4 rounded-lg border ${theme.panelBorder} text-[12px] font-semibold ${theme.textSecondary} ${theme.hoverBg}`}
          >
            취소
          </button>
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => { onImport(selected); onClose(); }}
            className={`h-9 px-5 rounded-lg text-[12px] font-bold text-white ${theme.accentBg}
              hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            대기열에 추가
          </button>
        </div>
      </footer>
    </Modal>
  );
};

export default ExcelUploadModal;
