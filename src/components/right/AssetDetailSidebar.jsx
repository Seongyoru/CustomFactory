/**
 * =============================================================================
 *  우측 사이드바 — 설비 상세 (기본 정보 / 점검 이력 / 시뮬레이션 제어 / 메모)
 * =============================================================================
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ChevronDown, Clock, Cpu, Pause, Play, Save, Siren, StickyNote, Wrench, X,
} from 'lucide-react';
import { STATUS } from '../../data/factoryAssets.js';
import { fmtClock, fmtDate, fmtKoDateTime, fmtKoDuration } from '../../lib/format.js';
import { ConsumableBar, GhostButton, Panel, PanelTitle, StatusLamp } from '../ui.jsx';
import TelemetryPanel from './TelemetryPanel.jsx';

const AssetDetailSidebar = ({
  theme, mode, asset, fault, lineStopped, onClose, now, memos, onAddMemo,
  memoAuthor = '-', canWriteMemo = true, memoHint, lineId, telemetry,
}) => {
  const [simCount, setSimCount] = useState(100);
  const [memoDraft, setMemoDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(true);

  /**
   * 설비 단독 가상 실행.
   *  시작을 누르면 이 설비의 사이클을 지정 횟수만큼 '가상으로 고속 실행'해서
   *  예상 생산량·불량·소요 시간을 결과로 보여준다. 실제 라인 상태는 건드리지
   *  않는 예측 도구다 — 몇 초짜리 진행 후 결과 카드가 나온다.
   */
  const [simRun, setSimRun] = useState(null); // null | {progress} | {done, result}
  const simTimerRef = useRef(null);

  const startSim = () => {
    if (!asset) return;
    clearInterval(simTimerRef.current);
    const DURATION_MS = 3500;
    const t0 = Date.now();
    const count = simCount;
    const cycleSec = asset.cycleSec;
    setSimRun({ progress: 0 });
    simTimerRef.current = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / DURATION_MS);
      if (k >= 1) {
        clearInterval(simTimerRef.current);
        setSimRun({
          done: true,
          result: {
            cycles: count,
            qty: count, // 1사이클 = 제품 1개 기준
            defects: Math.round(count * Math.random() * 0.02),
            totalSec: cycleSec * count,
          },
        });
      } else {
        setSimRun({ progress: k });
      }
    }, 80);
  };
  const stopSim = () => {
    clearInterval(simTimerRef.current);
    setSimRun(null);
  };
  /* 설비를 바꾸거나 패널이 닫히면 실행 중이던 가상 실행은 버린다 */
  useEffect(() => {
    clearInterval(simTimerRef.current);
    setSimRun(null);
  }, [asset?.id]);
  useEffect(() => () => clearInterval(simTimerRef.current), []);

  /* 사이클타임 × 횟수 = 총 소요 시간. 완료 '시각'과 걸리는 '시간'을 함께 보여준다. */
  const simTotalSec = asset ? asset.cycleSec * simCount : 0;
  const eta = useMemo(() => {
    if (!asset) return '--:--';
    return fmtClock(new Date(now.getTime() + simTotalSec * 1000), false);
  }, [asset, simTotalSec, now]);

  const open = Boolean(asset);
  /**
   * 표시 상태의 우선순위: 설비 오류 > 라인 비상 정지 > 마스터 상태.
   * 오류가 더 구체적이고 조치가 필요한 정보라 정지보다 앞선다.
   */
  const statusKey = fault ? 'ERROR' : lineStopped ? 'STOPPED' : asset?.status ?? 'IDLE';
  const status = STATUS[statusKey];
  const statusMessage = fault
    ? `[${fault.code}] ${fault.title}`
    : lineStopped
      ? '비상 정지로 라인 인터록 작동 중'
      : asset?.statusMessage ?? '-';

  const submitMemo = () => {
    const text = memoDraft.trim();
    if (!text || !asset) return;
    onAddMemo(asset.id, text);
    setMemoDraft('');
  };

  return (
    <aside
      className={`absolute top-0 right-0 h-full w-[360px] z-20 transition-transform duration-300 ease-out
        ${open ? 'translate-x-0' : 'translate-x-full'}`}
      aria-hidden={!open}
    >
      <div className={`h-full flex flex-col border-l ${theme.panelBorder} ${theme.headerBg} shadow-2xl shadow-black/40`}>
        {/* --- 헤더 --- */}
        <header className={`shrink-0 px-4 py-3 border-b ${theme.panelBorder} ${theme.accentBgSoft}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`text-[10px] font-semibold tracking-widest ${theme.accentText}`}>EQUIPMENT DETAIL</p>
              <h2 className={`mt-1 text-[17px] font-bold truncate ${theme.textPrimary}`}>{asset?.name ?? '-'}</h2>
              <p className={`text-[11px] tabular-nums mt-0.5 ${theme.textMuted}`}>{asset?.sn} / {asset?.mfgDate}</p>
              <p className={`text-[11px] mt-0.5 ${theme.textFaint}`}>{asset?.maker}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className={`shrink-0 grid place-items-center w-7 h-7 rounded-md ${theme.textMuted} ${theme.hoverBg}`}
              aria-label="닫기"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {asset?.consumable && (
            <div className={`mt-3 rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
              <ConsumableBar label={asset.consumable.label} percent={asset.consumable.percent} theme={theme} />
            </div>
          )}

          <div
            className={`mt-2 flex items-center gap-3 rounded-lg border px-3 py-2
              ${fault ? 'border-red-500/50 bg-red-500/10' : `${theme.panelBorder} ${theme.subtleBg}`}`}
          >
            <StatusLamp state={statusKey} size="lg" showLabel={false} />
            <div className="min-w-0">
              <p className={`text-[12px] font-semibold ${status?.text}`}>{status?.label}</p>
              <p className={`text-[11px] truncate ${theme.textMuted}`}>{statusMessage}</p>
            </div>
          </div>

          {/* 오류 상세 — 알람으로 올라온 내용을 설비 화면에서 다시 확인한다 */}
          {fault && (
            <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-red-500">
                  <Siren className="w-3.5 h-3.5" /> 설비 오류 발생
                </span>
                <span className={`text-[10px] tabular-nums ${theme.textMuted}`}>
                  {fmtDate(fault.at)} {fmtClock(fault.at)}
                </span>
              </div>
              <p className={`mt-1.5 text-[11px] leading-relaxed ${theme.textSecondary}`}>{fault.detail}</p>
              <p className={`mt-1.5 text-[10px] ${theme.textFaint}`}>
                운전 정지 상태입니다. 조치 후 상단 버튼으로 알람을 해제하세요.
              </p>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* --- 실시간 센서 --- */}
          {asset && telemetry && (
            <TelemetryPanel
              theme={theme}
              lineId={lineId}
              assetId={asset.id}
              latest={telemetry.latest}
              seriesOf={telemetry.seriesOf}
              sourceInfo={telemetry.sourceInfo}
            />
          )}

          {/* --- 기본 정보 --- */}
          <Panel theme={theme}>
            <PanelTitle icon={Cpu} title="기본 정보" theme={theme} />
            <dl className="p-3 grid grid-cols-3 gap-y-2.5 text-[11px]">
              {[
                ['설비 ID', asset?.id],
                ['설비명', asset?.nameKo],
                ['공정 역할', asset?.role],
                ['모델', asset?.model],
                ['제조사', asset?.maker],
                ['제조년월', asset?.mfgDate],
                ['설치일', asset?.installedAt],
                ['Cycle Time', asset ? `${asset.cycleSec.toFixed(1)} sec` : '-'],
              ].map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className={`col-span-1 ${theme.textFaint}`}>{k}</dt>
                  <dd className={`col-span-2 tabular-nums truncate ${theme.textSecondary}`}>{v ?? '-'}</dd>
                </React.Fragment>
              ))}
            </dl>
          </Panel>

          {/* --- 점검 이력 --- */}
          <Panel theme={theme}>
            <PanelTitle
              icon={Wrench}
              title="점검 이력"
              theme={theme}
              right={
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  className={`flex items-center gap-1 text-[10px] ${theme.textMuted}`}
                >
                  차기 {asset?.nextCheck ?? '-'}
                  <ChevronDown className={`w-3 h-3 transition-transform ${historyOpen ? '' : '-rotate-90'}`} />
                </button>
              }
            />
            {historyOpen && (
              <ol className="p-3 space-y-2.5">
                {(asset?.history ?? []).map((h, i) => (
                  <li key={i} className="relative pl-4">
                    <span className={`absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full ${i === 0 ? theme.accentBg : theme.dividerStrong}`} />
                    {i < (asset?.history.length ?? 0) - 1 && (
                      <span className={`absolute left-[2.5px] top-3.5 bottom-[-10px] w-px ${theme.dividerStrong}`} />
                    )}
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] tabular-nums ${theme.textSecondary}`}>{h.date}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] border ${theme.chip}`}>{h.type}</span>
                    </div>
                    <p className={`text-[11px] mt-0.5 ${theme.textFaint}`}>{h.note}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          {/* --- 시뮬레이션 제어 --- */}
          <Panel theme={theme} className={mode === 'simulation' ? theme.glow : ''}>
            <PanelTitle
              icon={Activity}
              title="시뮬레이션 제어"
              theme={theme}
              hint="이 설비의 사이클을 지정 횟수만큼 가상으로 고속 실행해 예상 생산량·불량·소요 시간을 예측합니다. 실제 라인 상태에는 영향이 없습니다."
              right={<span className={`text-[10px] px-2 py-0.5 rounded border ${theme.chip}`}>{mode === 'simulation' ? 'READY' : 'LIVE 잠금'}</span>}
            />
            <div className="p-3 space-y-3">
              <label className="block">
                <span className={`block text-[11px] mb-1 ${theme.textMuted}`}>시뮬레이션 횟수 (cycle)</span>
                <input
                  type="number" min={1} max={9999}
                  value={simCount}
                  onChange={(e) => setSimCount(Math.max(1, Number(e.target.value) || 1))}
                  disabled={mode !== 'simulation'}
                  className={`w-full h-9 px-3 rounded-lg border ${theme.panelBorder} ${theme.inputBg} text-sm tabular-nums
                    ${theme.textPrimary} focus:outline-none focus:ring-2 ${theme.accentRing}
                    disabled:opacity-40 disabled:cursor-not-allowed`}
                />
              </label>

              <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2 space-y-1.5`}>
                <div className="flex items-center justify-between">
                  <span className={`flex items-center gap-1.5 text-[11px] ${theme.textMuted}`}>
                    <Clock className="w-3.5 h-3.5" /> 예상 소요 시간
                  </span>
                  <span className={`text-sm font-bold tabular-nums ${theme.accentText}`}>
                    {asset ? fmtKoDuration(simTotalSec) : '-'}
                  </span>
                </div>
                <div className={`flex items-center justify-between border-t pt-1.5 ${theme.divider}`}>
                  <span className={`text-[11px] ${theme.textMuted}`}>예측 완료 시각</span>
                  <span className={`text-[12px] font-semibold tabular-nums ${theme.textSecondary}`}>{eta}</span>
                </div>
                <p className={`text-[10px] tabular-nums ${theme.textGhost}`}>
                  {asset ? `Cycle ${asset.cycleSec.toFixed(1)}s × ${simCount}회` : '-'}
                </p>
              </div>

              {/* 실행 중 — 진행바 */}
              {simRun && !simRun.done && (
                <div className={`rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-3 py-2`}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className={theme.textMuted}>가상 실행 중…</span>
                    <span className={`font-bold tabular-nums ${theme.accentText}`}>
                      {Math.round(simRun.progress * 100)}%
                    </span>
                  </div>
                  <div className={`mt-1.5 h-1.5 rounded-full overflow-hidden ${theme.trackBg}`}>
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${theme.barFrom} ${theme.barTo}`}
                      style={{ width: `${simRun.progress * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* 완료 — 예측 결과 */}
              {simRun?.done && (
                <div className={`rounded-lg border ${theme.panelBorder} ${theme.accentBgSoft} px-3 py-2.5`}>
                  <p className={`text-[11px] font-bold ${theme.accentText}`}>가상 실행 결과 (예측)</p>
                  <dl className="mt-1.5 grid grid-cols-3 gap-1.5 text-center">
                    {[
                      ['생산량', `${simRun.result.qty} EA`],
                      ['예상 불량', `${simRun.result.defects} EA`],
                      ['실소요 예상', fmtKoDuration(simRun.result.totalSec)],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className={`text-[10px] ${theme.textFaint}`}>{k}</dt>
                        <dd className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.textSecondary}`}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className={`mt-1.5 text-[10px] ${theme.textGhost}`}>
                    Cycle {simRun.result.cycles}회 기준 예측입니다. 실제 라인 상태에는 영향이 없습니다.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={startSim}
                  disabled={mode !== 'simulation' || Boolean(simRun && !simRun.done)}
                  className={`inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[12px] font-semibold
                    text-white transition ${theme.accentBg} hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  <Play className="w-4 h-4" /> {simRun?.done ? '다시 실행' : '시작'}
                </button>
                <button
                  type="button"
                  onClick={stopSim}
                  disabled={!simRun}
                  className={`inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[12px] font-semibold
                    border ${theme.panelBorder} ${theme.textSecondary} ${theme.hoverBg} transition
                    disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  <Pause className="w-4 h-4" /> {simRun?.done ? '결과 지우기' : '중지'}
                </button>
              </div>
            </div>
          </Panel>

          {/* --- 작업자 메모 (작성 시각 기록) --- */}
          <Panel theme={theme}>
            <PanelTitle
              icon={StickyNote}
              title="작업자 메모"
              theme={theme}
              right={<span className={`text-[10px] tabular-nums ${theme.textFaint}`}>{memos.length}건</span>}
            />
            <div className="p-3 space-y-2">
              {memos.length > 0 && (
                <ol className={`max-h-44 overflow-y-auto rounded-lg border ${theme.panelBorder} ${theme.subtleBg} p-2.5 space-y-2.5`}>
                  {memos.map((m) => (
                    <li key={m.id} className={`border-b last:border-0 pb-2 last:pb-0 ${theme.divider}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`text-[10px] font-semibold tabular-nums ${theme.accentText}`}>
                          {fmtKoDateTime(m.at)}
                        </span>
                        <span className={`text-[9px] ${theme.textFaint}`}>{m.author ?? memoAuthor}</span>
                      </div>
                      <p className={`mt-1 text-[11px] leading-relaxed whitespace-pre-wrap ${theme.textSecondary}`}>{m.text}</p>
                    </li>
                  ))}
                </ol>
              )}

              <textarea
                rows={3}
                value={memoDraft}
                disabled={!canWriteMemo}
                onChange={(e) => setMemoDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitMemo();
                }}
                placeholder={canWriteMemo ? '현장 특이사항을 입력하세요. (Ctrl+Enter 저장)' : memoHint ?? '메모 작성 권한이 없습니다.'}
                className={`w-full rounded-lg border ${theme.panelBorder} ${theme.inputBg} p-2.5 text-[12px] leading-relaxed
                  ${theme.textPrimary} resize-none focus:outline-none focus:ring-2 ${theme.accentRing}
                  disabled:opacity-40 disabled:cursor-not-allowed`}
              />
              <div className="flex items-center justify-between">
                <span className={`text-[10px] tabular-nums ${theme.textGhost}`}>{memoDraft.length} / 500</span>
                <GhostButton
                  icon={Save} theme={theme} onClick={submitMemo}
                  disabled={!canWriteMemo} title={!canWriteMemo ? memoHint : undefined}
                >
                  메모 저장
                </GhostButton>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </aside>
  );
};

export default AssetDetailSidebar;
