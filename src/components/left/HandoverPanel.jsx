/**
 * 교대 인수인계 노트 — 라인 단위 특이사항 보드.
 *  설비 메모(설비에 붙는 기록)와 달리, 교대가 넘어갈 때 라인 전체에 남기는 말이다.
 *  작성 시점의 교대(주간/야간)가 함께 박혀 "누가 어느 조에서 남겼나"가 남는다.
 */
import React, { useState } from 'react';
import { ClipboardList, Save } from 'lucide-react';
import { fmtKoDateTime } from '../../lib/format.js';
import { GhostButton, Panel, PanelTitle } from '../ui.jsx';

const HandoverPanel = ({ theme, notes = [], onAdd, canWrite = true, hint }) => {
  const [draft, setDraft] = useState('');
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
  };

  return (
    <Panel theme={theme} data-tour="handover">
      <PanelTitle
        icon={ClipboardList}
        title="교대 인수인계"
        theme={theme}
        hint="이 라인의 교대 인수인계 노트입니다. 설비 메모와 달리 라인 전체의 특이사항(자재 상황·주의점 등)을 다음 조에 전달할 때 씁니다. 작성 시점의 교대가 함께 기록됩니다."
        right={<span className={`text-[10px] tabular-nums ${theme.textFaint}`}>{notes.length}건</span>}
      />
      <div className="p-3 space-y-2">
        {notes.length > 0 && (
          <ol className={`max-h-40 overflow-y-auto rounded-lg border ${theme.panelBorder} ${theme.subtleBg} p-2.5 space-y-2.5`}>
            {notes.slice(0, 20).map((n) => (
              <li key={n.id} className={`border-b last:border-0 pb-2 last:pb-0 ${theme.divider}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[10px] font-semibold tabular-nums ${theme.accentText}`}>
                    {fmtKoDateTime(new Date(n.at))}
                  </span>
                  <span className={`shrink-0 text-[9px] ${theme.textFaint}`}>
                    <span className={`mr-1 px-1 py-px rounded border ${theme.chip}`}>{n.shiftLabel}</span>
                    {n.user}
                  </span>
                </div>
                <p className={`mt-1 text-[11px] leading-relaxed whitespace-pre-wrap ${theme.textSecondary}`}>{n.text}</p>
              </li>
            ))}
          </ol>
        )}

        <textarea
          rows={2}
          value={draft}
          disabled={!canWrite}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
          }}
          placeholder={canWrite ? '다음 조에 전달할 내용을 남기세요. (Ctrl+Enter 저장)' : hint ?? '작성 권한이 없습니다.'}
          className={`w-full rounded-lg border ${theme.panelBorder} ${theme.inputBg} p-2.5 text-[12px] leading-relaxed
            ${theme.textPrimary} resize-none focus:outline-none focus:ring-2 ${theme.accentRing}
            disabled:opacity-40 disabled:cursor-not-allowed`}
        />
        <div className="flex justify-end">
          <GhostButton icon={Save} theme={theme} onClick={submit} disabled={!canWrite} title={!canWrite ? hint : undefined}>
            노트 남기기
          </GhostButton>
        </div>
      </div>
    </Panel>
  );
};

export default HandoverPanel;
