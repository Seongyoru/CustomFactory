/**
 * 작업 취소 확인 모달
 *   대기열에서 선택한 작업을 빼기 전에 한 번 되묻는다.
 *   진행 중(선두) 작업이면 공정이 즉시 끊기므로 경고를 더 붙인다.
 */
import React from 'react';
import { Trash2 } from 'lucide-react';
import { STATUS } from '../../data/factoryAssets.js';
import { fmtDuration } from '../../lib/format.js';
import { Modal } from '../ui.jsx';

const JobCancelModal = ({ theme, job, isCurrent, onConfirm, onCancel }) => (
  <Modal theme={theme} onClose={onCancel} className="w-[400px]">
    <div className="p-6">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-red-500/15 text-red-500">
          <Trash2 className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h3 className={`text-base font-bold ${theme.textPrimary}`}>작업 취소</h3>
          <p className={`text-[11px] mt-0.5 tabular-nums ${theme.textMuted}`}>{job.id}</p>
        </div>
      </div>

      <p className={`mt-4 text-[12px] leading-relaxed ${theme.textSecondary}`}>
        <span className={`font-semibold ${theme.textPrimary}`}>{job.name}</span> 을(를) 대기열에서 제거합니다.
        {isCurrent && ' 진행 중인 작업이라 현재 공정이 즉시 중단되고 다음 작업이 올라옵니다.'}
        {' 되돌릴 수 없습니다.'}
      </p>

      <div className={`mt-3 grid grid-cols-3 gap-2 rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2 text-center`}>
        {[['수량', `${job.qty} EA`], ['표준시간', fmtDuration(job.totalSec)], ['상태', STATUS[job.state]?.label ?? '-']].map(([k, v]) => (
          <div key={k}>
            <p className={`text-[10px] ${theme.textFaint}`}>{k}</p>
            <p className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.textSecondary}`}>{v}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={`h-10 rounded-lg border ${theme.panelBorder} text-[12px] font-semibold ${theme.textSecondary} ${theme.hoverBg}`}
        >
          돌아가기
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="h-10 rounded-lg bg-red-600 hover:bg-red-500 text-[12px] font-bold text-white"
        >
          작업 취소
        </button>
      </div>
    </div>
  </Modal>
);

export default JobCancelModal;
