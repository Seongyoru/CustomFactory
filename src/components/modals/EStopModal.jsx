/** E-STOP 확인 모달 */
import React from 'react';
import { AlertOctagon } from 'lucide-react';
import { Modal } from '../ui.jsx';

const EStopModal = ({ theme, engaged, plantName, onConfirm, onCancel }) => (
  <Modal theme={theme} onClose={onCancel} className="w-[380px]">
    <div className="p-6">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-red-500/15 text-red-500">
          <AlertOctagon className="w-6 h-6" />
        </span>
        <div>
          <h3 className={`text-base font-bold ${theme.textPrimary}`}>{engaged ? '비상 정지 해제' : '비상 정지 실행'}</h3>
          <p className={`text-[11px] mt-0.5 ${theme.textMuted}`}>{plantName}</p>
        </div>
      </div>
      <p className={`mt-4 text-[12px] leading-relaxed ${theme.textSecondary}`}>
        {engaged
          ? '라인 전 설비의 인터록을 해제하고 운전 대기 상태로 복귀합니다. 현장 안전이 확보되었는지 확인하세요.'
          : '해당 라인의 모든 설비가 즉시 정지되며, 진행 중인 작업 지시는 보류됩니다. 계속하시겠습니까?'}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={`h-10 rounded-lg border ${theme.panelBorder} text-[12px] font-semibold ${theme.textSecondary} ${theme.hoverBg}`}
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="h-10 rounded-lg bg-red-600 hover:bg-red-500 text-[12px] font-bold text-white"
        >
          {engaged ? '해제 확인' : '즉시 정지'}
        </button>
      </div>
    </div>
  </Modal>
);

export default EStopModal;
