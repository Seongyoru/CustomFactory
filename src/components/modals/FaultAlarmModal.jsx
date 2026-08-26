/**
 * 설비 오류 알람 팝업
 *  현장에서 올라온 설비 오류를 즉시 알린다. 어느 라인 · 어느 설비 · 언제 ·
 *  무슨 오류인지를 한 화면에서 읽을 수 있어야 한다.
 *
 *  닫기 버튼도, 바깥 클릭으로 닫기도 없다. 놓치면 안 되는 알림이라
 *  '해당 설비로 이동'을 눌러 확인해야만 사라지고 비네팅도 그때 멈춘다.
 */
import React from 'react';
import { Crosshair, Siren } from 'lucide-react';
import { fmtClock, fmtDate } from '../../lib/format.js';
import { Modal } from '../ui.jsx';

const FaultAlarmModal = ({ theme, alarm, lineName, asset, onGoTo, pendingCount = 0 }) => (
  <Modal theme={theme} onClose={() => {}} className="w-[480px]">
    <div className="border-b-4 border-red-600">
      <header className="flex items-center gap-3 px-5 py-4 bg-red-600/15">
        <span className="grid place-items-center w-12 h-12 rounded-xl bg-red-600 text-white shrink-0 animate-pulse">
          <Siren className="w-6 h-6" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.2em] text-red-500">EQUIPMENT FAULT</p>
          <h3 className={`mt-0.5 text-[17px] font-bold truncate ${theme.textPrimary}`}>
            {alarm.title}
          </h3>
          <p className={`text-[11px] mt-0.5 tabular-nums ${theme.textMuted}`}>
            알람 코드 {alarm.code}
          </p>
        </div>
      </header>
    </div>

    <div className="p-5 space-y-3">
      <dl className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} divide-y ${theme.divider}`}>
        {[
          ['생산 라인', lineName],
          ['발생 설비', asset ? `${asset.name} (${asset.nameKo})` : alarm.assetId],
          ['설비 위치', asset?.role ?? '-'],
          ['발생 시각', `${fmtDate(alarm.at)} ${fmtClock(alarm.at)}`],
        ].map(([k, v]) => (
          <div key={k} className="flex items-start gap-3 px-3 py-2">
            <dt className={`w-[68px] shrink-0 text-[11px] ${theme.textFaint}`}>{k}</dt>
            <dd className={`flex-1 text-[12px] font-medium ${theme.textSecondary}`}>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5">
        <p className="text-[11px] font-bold text-red-500">오류 내용</p>
        <p className={`mt-1 text-[12px] leading-relaxed ${theme.textSecondary}`}>{alarm.detail}</p>
      </div>

      <p className={`text-[11px] leading-relaxed ${theme.textFaint}`}>
        해당 설비는 운전을 멈춘 상태입니다. 아래 버튼을 누르면 알람을 확인 처리하고
        3D 화면이 해당 설비로 이동합니다.
      </p>

      <button
        type="button"
        onClick={onGoTo}
        className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-lg
          bg-red-600 hover:bg-red-500 text-[13px] font-bold text-white
          focus:outline-none focus:ring-4 focus:ring-red-500/40 transition-colors"
      >
        <Crosshair className="w-4 h-4" />
        해당 설비로 이동
      </button>

      {/* 알람이 밀려 있으면 알려준다 — 확인하면 다음 건이 이어서 뜬다 */}
      {pendingCount > 0 && (
        <p className="text-center text-[11px] font-semibold text-red-500">
          미확인 알람 {pendingCount}건이 더 있습니다 — 확인하면 이어서 표시됩니다.
        </p>
      )}
    </div>
  </Modal>
);

export default FaultAlarmModal;
