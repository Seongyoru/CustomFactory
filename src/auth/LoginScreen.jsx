/**
 * =============================================================================
 *  로그인 화면 — 계정 카드 선택 + PIN 입력 (데모용)
 * =============================================================================
 */
import React, { useState } from 'react';
import { Factory, KeyRound, LogIn, ShieldCheck, User } from 'lucide-react';
import { ROLES, USERS } from './auth.js';
import { BrandLogo } from '../components/ui.jsx';

const ROLE_BADGE = {
  admin: 'text-red-500 border-red-500/40 bg-red-500/10',
  operator: 'text-sky-500 border-sky-500/40 bg-sky-500/10',
  viewer: 'text-slate-400 border-slate-500/40 bg-slate-500/10',
};

const LoginScreen = ({ theme, onLogin }) => {
  const [selectedId, setSelectedId] = useState(USERS[0].id);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const selected = USERS.find((u) => u.id === selectedId);

  const submit = () => {
    if (!selected) return;
    if (pin !== selected.pin) {
      setError('PIN이 올바르지 않습니다.');
      setPin('');
      return;
    }
    onLogin(selected);
  };

  return (
    <div className={`w-screen h-screen grid place-items-center font-sans ${theme.appBg}`}>
      <div className={`w-[420px] rounded-2xl border ${theme.panelBorder} ${theme.headerBg} shadow-2xl overflow-hidden`}>
        {/* 브랜드 헤더 */}
        <header className={`px-6 pt-7 pb-5 text-center border-b ${theme.divider}`}>
          <div className="flex items-center justify-center gap-2.5">
            <BrandLogo theme={theme} />
            <div className="text-left leading-none">
              <p className={`text-[17px] font-bold tracking-tight ${theme.textPrimary}`}>
                EGIS <span className={theme.accentText}>Factory</span>
              </p>
              <p className={`text-[10px] mt-1 ${theme.textFaint}`}>Digital Twin System</p>
            </div>
          </div>
          <p className={`mt-4 flex items-center justify-center gap-1.5 text-[11px] ${theme.textMuted}`}>
            <ShieldCheck className={`w-3.5 h-3.5 ${theme.accentText}`} />
            계정을 선택하고 PIN을 입력하세요
          </p>
        </header>

        <div className="p-6 space-y-4">
          {/* 계정 카드 */}
          <ul className={`rounded-xl border ${theme.panelBorder} divide-y ${theme.divider} overflow-hidden`}>
            {USERS.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => { setSelectedId(u.id); setPin(''); setError(''); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                    ${selectedId === u.id ? theme.accentBgSoft : theme.hoverBg}`}
                >
                  <span className={`grid place-items-center w-9 h-9 rounded-full shrink-0
                    ${selectedId === u.id ? theme.accentBg : theme.subtleBg} ${selectedId === u.id ? 'text-white' : theme.textMuted}`}>
                    <User className="w-4.5 h-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] font-semibold ${theme.textPrimary}`}>{u.name}</span>
                    <span className={`block text-[10px] mt-0.5 tabular-nums ${theme.textFaint}`}>데모 PIN · {u.pin}</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${ROLE_BADGE[u.role]}`}>
                    {ROLES[u.role].label}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* PIN */}
          <div>
            <label className="block">
              <span className={`flex items-center gap-1.5 text-[11px] mb-1.5 ${theme.textMuted}`}>
                <KeyRound className="w-3.5 h-3.5" /> PIN (4자리)
              </span>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                autoFocus
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && pin.length === 4) submit(); }}
                placeholder="••••"
                className={`w-full h-11 px-4 rounded-lg border text-center text-lg tracking-[0.6em] tabular-nums
                  ${theme.panelBorder} ${theme.inputBg} ${theme.textPrimary}
                  focus:outline-none focus:ring-2 ${theme.accentRing}`}
              />
            </label>
            {error && <p className="mt-1.5 text-[11px] text-red-500">{error}</p>}
          </div>

          <button
            type="button"
            disabled={pin.length !== 4}
            onClick={submit}
            className={`w-full inline-flex items-center justify-center gap-2 h-11 rounded-lg text-[13px] font-bold
              text-white ${theme.accentBg} hover:opacity-90 transition
              disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            <LogIn className="w-4 h-4" />
            {selected ? `${selected.name} 계정으로 로그인` : '로그인'}
          </button>
        </div>

        <footer className={`px-6 py-3 border-t ${theme.divider} flex items-center justify-between text-[10px] ${theme.textGhost}`}>
          <span className="flex items-center gap-1"><Factory className="w-3 h-3" /> EGIS Factory HQ</span>
          <span>데모 환경 · 로컬 인증</span>
        </footer>
      </div>
    </div>
  );
};

export default LoginScreen;
