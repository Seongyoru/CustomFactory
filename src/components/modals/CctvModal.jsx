/** CCTV 확대 모달 */
import React from 'react';
import { Video, X } from 'lucide-react';
import { fmtClock, fmtDate } from '../../lib/format.js';
import { Modal } from '../ui.jsx';
import CctvVideo from '../CctvVideo.jsx';

const CctvModal = ({ theme, cam, now, onClose }) => (
  <Modal theme={theme} onClose={onClose} className="w-[880px]">
    <header className={`flex items-center justify-between px-4 py-3 border-b ${theme.panelBorder}`}>
      <div className="flex items-center gap-2">
        <Video className={`w-4 h-4 ${theme.accentText}`} />
        <h3 className={`text-sm font-bold ${theme.textPrimary}`}>{cam.label}</h3>
        <span className={`px-1.5 py-0.5 rounded text-[10px] tabular-nums border ${theme.chip}`}>{cam.id}</span>
        <span className="flex items-center gap-1 text-[10px] text-red-500">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> REC
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-[11px] font-semibold tabular-nums ${theme.textSecondary}`}>{fmtDate(now)} {fmtClock(now)}</span>
        <button type="button" onClick={onClose} className={`grid place-items-center w-7 h-7 rounded-md ${theme.textMuted} ${theme.hoverBg}`} aria-label="닫기">
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
    <div className="relative bg-black">
      <CctvVideo src={cam.src} variant="modal" />
      <div
        className="absolute inset-0 opacity-15 pointer-events-none mix-blend-overlay"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(0,0,0,.5) 0px, rgba(0,0,0,.5) 1px, transparent 1px, transparent 3px)',
        }}
      />
    </div>
  </Modal>
);

export default CctvModal;
