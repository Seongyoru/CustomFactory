/**
 * 데이터 소스 설정 — 시뮬레이션 ↔ OPC-UA 게이트웨이 전환 + CCTV 스트림 주소
 *  (전환·수정은 관리자 전용)
 *  게이트웨이가 없는 환경(정적 데모 배포)에서는 기능을 숨기지 않고
 *  '대신 이렇게 하세요' 안내로 갈라 둔다.
 *  비관리자에게는 읽기 전용으로 열린다 — 연결 실패 시 원인·조치 안내는
 *  권한과 무관하게 닿아야 하기 때문이다.
 */
import React, { useState } from 'react';
import { Cctv, Radio, X } from 'lucide-react';
import { Modal } from '../ui.jsx';

const SourceSettingsModal = ({
  theme, config, connectionStatus, readOnly = false, onSave, onClose,
  cctvFeeds = [], cctvConfig = {}, onSaveCctv,
}) => {
  const [type, setType] = useState(config?.type === 'opcua' ? 'opcua' : 'sim');
  const [url, setUrl] = useState(config?.url ?? 'wss://');
  const [error, setError] = useState('');
  /* 카메라별 스트림 주소 초안 — 빈 값 = 기본 데모 영상 */
  const [cctvDraft, setCctvDraft] = useState(() =>
    Object.fromEntries(cctvFeeds.map((f) => [f.id, cctvConfig[f.id] ?? '']))
  );

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

  /* 카메라 주소 검증 — 빈 값은 기본 영상 복귀라 통과 */
  const cctvUrlError = (raw) => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    let parsed;
    try {
      if (/\s/.test(trimmed)) throw new Error('whitespace');
      parsed = new URL(trimmed);
    } catch {
      return '올바른 URL 형식이 아닙니다.';
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '카메라 주소는 http:// 또는 https:// 로 시작해야 합니다 (HLS .m3u8 권장).';
    }
    if (isHttps && parsed.protocol === 'http:') {
      return 'HTTPS 로 배포된 페이지에서는 https:// 스트림만 재생됩니다.';
    }
    return null;
  };

  const save = () => {
    if (readOnly) return;
    for (const f of cctvFeeds) {
      const e = cctvUrlError(cctvDraft[f.id] ?? '');
      if (e) {
        setError(`${f.id}: ${e}`);
        return;
      }
    }
    if (type === 'opcua') {
      const trimmed = url.trim();
      /* URL 파서로 검증한다 — 정규식과 달리 대문자 스킴(WSS://…)을 정상 수용한다.
         내부 공백은 명시적으로 거부한다: 브라우저 URL 파서가 %20 으로 인코딩해
         통과시키는 경우가 있어, 오타가 저장돼 무한 재연결에 빠질 수 있다 */
      let parsed;
      try {
        if (/\s/.test(trimmed)) throw new Error('whitespace');
        parsed = new URL(trimmed);
      } catch {
        setError('올바른 URL 형식이 아닙니다. 예: wss://gateway.factory.local:8125');
        return;
      }
      if (!['ws:', 'wss:'].includes(parsed.protocol)) {
        setError('게이트웨이 주소는 ws:// 또는 wss:// 로 시작해야 합니다.');
        return;
      }
      if (isHttps && parsed.protocol === 'ws:') {
        setError('HTTPS 로 배포된 페이지에서는 보안 연결(wss://)만 허용됩니다.');
        return;
      }
      onSave({ type: 'opcua', url: parsed.href });
    } else {
      onSave({ type: 'sim' });
    }
    /* 카메라 주소 — 빈 값은 저장하지 않는다 (기본 데모 영상으로 복귀) */
    onSaveCctv?.(
      Object.fromEntries(
        Object.entries(cctvDraft)
          .map(([id, u]) => [id, u.trim()])
          .filter(([, u]) => u !== '')
      )
    );
    onClose();
  };

  return (
    <Modal theme={theme} onClose={onClose} className="w-[460px]">
      <header className={`flex items-center justify-between px-5 py-3.5 border-b ${theme.panelBorder} ${theme.accentBgSoft}`}>
        <div className="flex items-center gap-2">
          <Radio className={`w-4 h-4 ${theme.accentText}`} />
          <h3 className={`text-sm font-bold ${theme.textPrimary}`}>데이터 소스 설정</h3>
        </div>
        <button type="button" onClick={onClose} className={`grid place-items-center w-7 h-7 rounded-md ${theme.textMuted} ${theme.hoverBg}`} aria-label="닫기">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="p-5 space-y-3">
        {readOnly && (
          <p className={`rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-600`}>
            데이터 소스 전환은 시스템 관리자만 가능합니다. 현재 설정과 연결 상태만 확인할 수
            있으며, 전환이 필요하면 관리자에게 요청하세요.
          </p>
        )}
        {[
          {
            key: 'sim',
            title: '시뮬레이션 소스',
            desc: '내장 확률 모델이 설비 계측을 생성합니다. 서버 없이 어디서든 동작합니다 (데모 기본값).',
          },
          {
            key: 'opcua',
            title: 'OPC-UA 게이트웨이',
            desc: '사내망의 WebSocket 게이트웨이(OPC-UA ↔ WS 중계)에 연결해 실설비 계측·알람을 받습니다.',
          },
        ].map((opt) => (
          <button
            key={opt.key}
            type="button"
            disabled={readOnly}
            onClick={readOnly ? undefined : () => { setType(opt.key); setError(''); }}
            className={`w-full flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors
              ${type === opt.key ? theme.accentBgSoft : `${theme.panelBorder} ${readOnly ? '' : theme.hoverBg}`}
              ${readOnly ? 'cursor-default opacity-80' : ''}`}
            style={type === opt.key ? { borderColor: theme.accentHex } : undefined}
          >
            <span
              className={`mt-0.5 grid place-items-center w-4 h-4 rounded-full border-2 shrink-0
                ${type === opt.key ? `${theme.accentBg} border-transparent` : theme.panelBorder}`}
            >
              {type === opt.key && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
            </span>
            <span className="min-w-0">
              <span className={`block text-[12px] font-semibold ${theme.textPrimary}`}>{opt.title}</span>
              <span className={`block text-[11px] mt-0.5 leading-relaxed ${theme.textMuted}`}>{opt.desc}</span>
            </span>
          </button>
        ))}

        {type === 'opcua' && (
          <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} p-3 space-y-2`}>
            <label className="block">
              <span className={`block text-[11px] mb-1 ${theme.textMuted}`}>게이트웨이 주소</span>
              <input
                value={url}
                disabled={readOnly}
                onChange={(e) => { setUrl(e.target.value); setError(''); }}
                placeholder="wss://gateway.factory.local:8125"
                spellCheck={false}
                className={`w-full h-9 px-3 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
                  text-[12px] tabular-nums ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}
                  disabled:opacity-60`}
              />
            </label>
            {connectionStatus && ['error', 'reconnecting'].includes(connectionStatus) && (
              <p className="text-[11px] leading-relaxed text-amber-500">
                현재 게이트웨이에 연결하지 못하고 있습니다. 정적 데모 배포에는 게이트웨이가
                포함되지 않습니다 — 사내망에서 OPC-UA ↔ WebSocket 중계 서버를 띄우거나,
                시뮬레이션 소스로 전환해 사용하세요.
                {readOnly && ' (전환은 시스템 관리자에게 요청)'}
              </p>
            )}
            <p className={`text-[10px] leading-relaxed ${theme.textGhost}`}>
              메시지 프로토콜: {'{ type: "telemetry", readings: { 라인: { 설비: { temp·vib·amp } } } }'} ·{' '}
              {'{ type: "alarm", lineId·assetId·code·title·detail }'} — 자세한 형식은
              src/telemetry/opcuaSource.js 참조. 연결이 끊기면 자동 재접속합니다.
            </p>
          </div>
        )}

        {/* CCTV 스트림 주소 — 카메라별 오버라이드 (빈 칸 = 기본 데모 영상) */}
        {cctvFeeds.length > 0 && (
          <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} p-3 space-y-2`}>
            <p className={`flex items-center gap-1.5 text-[11px] font-semibold ${theme.textPrimary}`}>
              <Cctv className={`w-3.5 h-3.5 ${theme.accentText}`} /> CCTV 스트림 주소
            </p>
            <p className={`text-[10px] leading-relaxed ${theme.textGhost}`}>
              카메라별 실스트림(HLS .m3u8 권장) 주소를 넣으면 데모 영상 대신 재생됩니다.
              비워 두면 기본 데모 영상(mp4 루프)을 씁니다. RTSP 카메라는 MediaMTX 같은
              중계 서버로 HLS 변환이 필요합니다.
            </p>
            {cctvFeeds.map((f) => (
              <label key={f.id} className="block">
                <span className={`block text-[10px] mb-1 ${theme.textMuted}`}>
                  {f.id} · {f.label}
                </span>
                <input
                  value={cctvDraft[f.id] ?? ''}
                  disabled={readOnly}
                  onChange={(e) => {
                    setCctvDraft((prev) => ({ ...prev, [f.id]: e.target.value }));
                    setError('');
                  }}
                  placeholder="https://stream.factory.local/cam-01/index.m3u8"
                  spellCheck={false}
                  className={`w-full h-8 px-3 rounded-lg border ${theme.panelBorder} ${theme.inputBg}
                    text-[11px] tabular-nums ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}
                    disabled:opacity-60`}
                />
              </label>
            ))}
          </div>
        )}

        {error && <p className="text-[11px] text-red-500">{error}</p>}
      </div>

      <footer className={`flex items-center justify-end gap-2 px-5 py-3 border-t ${theme.panelBorder} ${theme.subtleBg}`}>
        <button
          type="button"
          onClick={onClose}
          className={`h-9 px-4 rounded-lg border ${theme.panelBorder} text-[12px] font-semibold ${theme.textSecondary} ${theme.hoverBg}`}
        >
          {readOnly ? '닫기' : '취소'}
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={save}
            className={`h-9 px-5 rounded-lg text-[12px] font-bold text-white ${theme.accentBg} hover:opacity-90`}
          >
            적용
          </button>
        )}
      </footer>
    </Modal>
  );
};

export default SourceSettingsModal;
