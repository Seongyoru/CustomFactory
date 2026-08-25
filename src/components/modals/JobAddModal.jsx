/**
 * 로트 추가 모달 — 품목 카탈로그에서 선택 + 새 품목 등록
 *  작업지시는 로트(품목 + 수량) 단위다. 표준시간은 수량 × 택트타임으로
 *  자동 계산되어 미리 보여준다.
 */
import React, { useState } from 'react';
import { Package, Plus, X } from 'lucide-react';
import { lotTotalSec } from '../../data/factoryAssets.js';
import { fmtDuration, fmtKoDuration } from '../../lib/format.js';
import { GhostButton, Modal } from '../ui.jsx';

const JobAddModal = ({ theme, products, onAddProduct, onAddLot, onClose }) => {
  const [selectedId, setSelectedId] = useState(products[0]?.id ?? null);
  const [qty, setQty] = useState(products[0]?.defaultQty ?? 100);
  const [draft, setDraft] = useState({ name: '', taktSec: 7.5, defaultQty: 100 });
  const [error, setError] = useState('');

  const selected = products.find((p) => p.id === selectedId) ?? null;
  /* 표준시간 = 애니메이션 유도 (도입·마무리 포함) — 공정 완료 = 애니메이션 완료 */
  const totalSec = selected ? lotTotalSec(qty, selected.taktSec) : 0;

  const pick = (product) => {
    setSelectedId(product.id);
    setQty(product.defaultQty);
  };

  const registerProduct = () => {
    const name = draft.name.trim();
    if (!name) return setError('품목명을 입력하세요.');
    if (products.some((p) => p.name === name)) return setError('이미 같은 이름의 품목이 있습니다.');
    const takt = Number(draft.taktSec);
    if (!(takt > 0)) return setError('택트타임은 0보다 커야 합니다.');
    const product = {
      id: `PRD-${String(products.length + 1).padStart(2, '0')}`,
      name,
      taktSec: takt,
      defaultQty: Math.max(1, Number(draft.defaultQty) || 1),
    };
    onAddProduct(product);
    setDraft({ name: '', taktSec: 7.5, defaultQty: 100 });
    setError('');
    pick(product);
  };

  return (
    <Modal theme={theme} onClose={onClose} className="w-[560px]">
      <header className={`flex items-center justify-between px-5 py-3.5 border-b ${theme.panelBorder} ${theme.accentBgSoft}`}>
        <div className="flex items-center gap-2">
          <Package className={`w-4 h-4 ${theme.accentText}`} />
          <h3 className={`text-sm font-bold ${theme.textPrimary}`}>로트 추가</h3>
          <span className={`px-1.5 py-0.5 rounded text-[10px] border ${theme.chip}`}>품목 + 수량</span>
        </div>
        <button type="button" onClick={onClose} className={`grid place-items-center w-7 h-7 rounded-md ${theme.textMuted} ${theme.hoverBg}`} aria-label="닫기">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="max-h-[70vh] overflow-y-auto p-5 space-y-5">
        {/* 1) 품목 선택 */}
        <section>
          <h4 className={`text-[11px] font-bold tracking-wider mb-2 ${theme.textMuted}`}>1. 품목 선택</h4>
          <ul className={`rounded-lg border ${theme.panelBorder} divide-y ${theme.divider} overflow-hidden`}>
            {products.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => pick(product)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                    ${selectedId === product.id ? theme.accentBgSoft : theme.hoverBg}`}
                >
                  <span
                    className={`grid place-items-center w-4 h-4 rounded-full border-2 shrink-0
                      ${selectedId === product.id ? `${theme.accentBg} border-transparent` : theme.panelBorder}`}
                  >
                    {selectedId === product.id && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[12px] font-medium truncate ${theme.textPrimary}`}>{product.name}</span>
                    <span className={`block text-[10px] tabular-nums ${theme.textFaint}`}>
                      {product.id} · 택트 {product.taktSec}s/EA · 기본 {product.defaultQty} EA
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-end gap-2">
            <label className="flex-1">
              <span className={`block text-[11px] mb-1 ${theme.textMuted}`}>로트 수량 (EA)</span>
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
              onClick={() => { onAddLot(selected, qty); onClose(); }}
              className={`h-9 px-5 rounded-lg text-[12px] font-bold text-white ${theme.accentBg}
                hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              대기열에 추가
            </button>
          </div>

          {/* 표준시간 자동 계산 미리보기 */}
          {selected && (
            <p className={`mt-2 text-[11px] tabular-nums ${theme.textFaint}`}>
              표준시간 <b className={theme.textSecondary}>{fmtDuration(totalSec)}</b>
              <span className={theme.textGhost}> · 택트 {selected.taktSec}s/EA + 도입·마무리 포함</span>
              <span className={`ml-2 ${theme.textGhost}`}>(약 {fmtKoDuration(totalSec)})</span>
            </p>
          )}
        </section>

        {/* 2) 새 품목 등록 */}
        <section className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} p-3.5`}>
          <h4 className={`text-[11px] font-bold tracking-wider mb-2.5 ${theme.textMuted}`}>2. 새 품목 등록</h4>
          <div className="grid grid-cols-[1fr_96px_84px] gap-2">
            <label>
              <span className={`block text-[10px] mb-1 ${theme.textFaint}`}>품목명</span>
              <input
                value={draft.name}
                onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setError(''); }}
                placeholder="예: HPG 실린더 40L"
                className={`w-full h-9 px-3 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
                  text-[12px] ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}`}
              />
            </label>
            <label>
              <span className={`block text-[10px] mb-1 ${theme.textFaint}`}>택트(초/EA)</span>
              <input
                type="number" min={0.5} step={0.1}
                value={draft.taktSec}
                onChange={(e) => setDraft({ ...draft, taktSec: e.target.value })}
                className={`w-full h-9 px-2 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
                  text-[12px] text-right tabular-nums ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}`}
              />
            </label>
            <label>
              <span className={`block text-[10px] mb-1 ${theme.textFaint}`}>기본 수량</span>
              <input
                type="number" min={1}
                value={draft.defaultQty}
                onChange={(e) => setDraft({ ...draft, defaultQty: e.target.value })}
                className={`w-full h-9 px-2 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
                  text-[12px] text-right tabular-nums ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}`}
              />
            </label>
          </div>
          {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
          <div className="mt-2.5 flex justify-end">
            <GhostButton icon={Plus} theme={theme} onClick={registerProduct} className="px-3">
              품목 카탈로그에 등록
            </GhostButton>
          </div>
        </section>
      </div>
    </Modal>
  );
};

export default JobAddModal;
