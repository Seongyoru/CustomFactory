/**
 * 작업 추가 모달 — 카탈로그에서 선택 + 새 작업 설정 등록
 */
import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { fmtDuration } from '../../lib/format.js';
import { GhostButton, Modal } from '../ui.jsx';

const JobAddModal = ({ theme, templates, onAddTemplate, onAddJob, onClose }) => {
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? null);
  const [qty, setQty] = useState(templates[0]?.qty ?? 100);
  const [draft, setDraft] = useState({ name: '', qty: 100, minutes: 15 });
  const [error, setError] = useState('');

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const pick = (tpl) => {
    setSelectedId(tpl.id);
    setQty(tpl.qty);
  };

  const registerTemplate = () => {
    const name = draft.name.trim();
    if (!name) return setError('작업명을 입력하세요.');
    if (templates.some((t) => t.name === name)) return setError('이미 같은 이름의 작업이 있습니다.');
    const tpl = {
      id: `TPL-${String(templates.length + 1).padStart(2, '0')}`,
      name,
      qty: Math.max(1, Number(draft.qty) || 1),
      totalSec: Math.max(60, Math.round((Number(draft.minutes) || 1) * 60)),
    };
    onAddTemplate(tpl);
    setDraft({ name: '', qty: 100, minutes: 15 });
    setError('');
    pick(tpl);
  };

  return (
    <Modal theme={theme} onClose={onClose} className="w-[560px]">
      <header className={`flex items-center justify-between px-5 py-3.5 border-b ${theme.panelBorder} ${theme.accentBgSoft}`}>
        <div className="flex items-center gap-2">
          <Plus className={`w-4 h-4 ${theme.accentText}`} />
          <h3 className={`text-sm font-bold ${theme.textPrimary}`}>작업 추가</h3>
        </div>
        <button type="button" onClick={onClose} className={`grid place-items-center w-7 h-7 rounded-md ${theme.textMuted} ${theme.hoverBg}`} aria-label="닫기">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="max-h-[70vh] overflow-y-auto p-5 space-y-5">
        {/* 1) 카탈로그에서 선택 */}
        <section>
          <h4 className={`text-[11px] font-bold tracking-wider mb-2 ${theme.textMuted}`}>1. 작업 선택</h4>
          <ul className={`rounded-lg border ${theme.panelBorder} divide-y ${theme.divider} overflow-hidden`}>
            {templates.map((tpl) => (
              <li key={tpl.id}>
                <button
                  type="button"
                  onClick={() => pick(tpl)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                    ${selectedId === tpl.id ? theme.accentBgSoft : theme.hoverBg}`}
                >
                  <span
                    className={`grid place-items-center w-4 h-4 rounded-full border-2 shrink-0
                      ${selectedId === tpl.id ? `${theme.accentBg} border-transparent` : theme.panelBorder}`}
                  >
                    {selectedId === tpl.id && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[12px] font-medium truncate ${theme.textPrimary}`}>{tpl.name}</span>
                    <span className={`block text-[10px] tabular-nums ${theme.textFaint}`}>
                      {tpl.id} · 기본 {tpl.qty} EA · 표준 {fmtDuration(tpl.totalSec)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-end gap-2">
            <label className="flex-1">
              <span className={`block text-[11px] mb-1 ${theme.textMuted}`}>수량 (EA)</span>
              <input
                type="number" min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                className={`w-full h-9 px-3 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
                  text-sm tabular-nums ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}`}
              />
            </label>
            <button
              type="button"
              disabled={!selected}
              onClick={() => { onAddJob(selected, qty); onClose(); }}
              className={`h-9 px-5 rounded-lg text-[12px] font-bold text-white ${theme.accentBg}
                hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              대기열에 추가
            </button>
          </div>
        </section>

        {/* 2) 새 작업 설정 등록 */}
        <section className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} p-3.5`}>
          <h4 className={`text-[11px] font-bold tracking-wider mb-2.5 ${theme.textMuted}`}>2. 새 작업 설정 등록</h4>
          <div className="grid grid-cols-[1fr_84px_96px] gap-2">
            <label>
              <span className={`block text-[10px] mb-1 ${theme.textFaint}`}>작업명</span>
              <input
                value={draft.name}
                onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setError(''); }}
                placeholder="예: HPG 실린더 리크 검사"
                className={`w-full h-9 px-3 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
                  text-[12px] ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}`}
              />
            </label>
            <label>
              <span className={`block text-[10px] mb-1 ${theme.textFaint}`}>수량</span>
              <input
                type="number" min={1}
                value={draft.qty}
                onChange={(e) => setDraft({ ...draft, qty: e.target.value })}
                className={`w-full h-9 px-2 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
                  text-[12px] text-right tabular-nums ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}`}
              />
            </label>
            <label>
              <span className={`block text-[10px] mb-1 ${theme.textFaint}`}>표준시간(분)</span>
              <input
                type="number" min={1}
                value={draft.minutes}
                onChange={(e) => setDraft({ ...draft, minutes: e.target.value })}
                className={`w-full h-9 px-2 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
                  text-[12px] text-right tabular-nums ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}`}
              />
            </label>
          </div>
          {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
          <div className="mt-2.5 flex justify-end">
            <GhostButton icon={Plus} theme={theme} onClick={registerTemplate} className="px-3">
              작업 목록에 등록
            </GhostButton>
          </div>
        </section>
      </div>
    </Modal>
  );
};

export default JobAddModal;
