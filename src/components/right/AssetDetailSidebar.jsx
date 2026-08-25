/**
 * =============================================================================
 *  우측 사이드바 — 설비 상세 (실시간 센서 / 기본 정보 / 점검 이력 / 병목 분석 / 메모)
 * =============================================================================
 */
import React, { useState } from 'react';
import {
  ChevronDown, Cpu, GitCommitHorizontal, Save, Siren, StickyNote, Wrench, X,
} from 'lucide-react';
import { PROCESS_CYCLE_SEC, PROCESS_PHASES, STATUS } from '../../data/factoryAssets.js';
import { fmtClock, fmtDate, fmtKoDateTime } from '../../lib/format.js';
import { ConsumableBar, GhostButton, Panel, PanelTitle, StatusLamp } from '../ui.jsx';
import TelemetryPanel from './TelemetryPanel.jsx';

/**
 * 병목 분석 — 라인 1사이클(TOTAL 7.2s 마스터 타임라인)에서 이 설비가 실제로
 * 움직이는 구간을 근거로, 사이클 점유율·여유율·병목 여부를 보여준다.
 *  이 라인은 전 설비가 한 사이클로 묶인 흐름 생산이라 설비 단독 시뮬레이션은
 *  성립하지 않는다 — 대신 "누가 사이클을 가장 오래 붙잡는가"가 유효한 질문이다.
 */
const BottleneckPanel = ({ theme, asset, lineTaktSec }) => {
  const durOf = (p) => p.end - p.start;
  const mine = PROCESS_PHASES.find((p) => p.id === asset.id) ?? null;
  if (!mine) return null;

  const maxDur = Math.max(...PROCESS_PHASES.map(durOf));
  const isBottleneck = durOf(mine) === maxDur;
  const share = durOf(mine) / PROCESS_CYCLE_SEC; // 사이클 점유율
  const busySec = lineTaktSec * share; // 현재 로트 택트 기준 실작동 시간
  const pct = (t) => `${(t / PROCESS_CYCLE_SEC) * 100}%`;

  return (
    <Panel theme={theme}>
      <PanelTitle
        icon={GitCommitHorizontal}
        title="병목 분석"
        theme={theme}
        hint="라인 1사이클 안에서 각 설비가 실제로 움직이는 구간입니다. 가장 오래 움직이는 설비가 라인 속도를 결정하는 병목입니다. 이 라인은 전 설비가 한 사이클로 묶여 있어 설비 단독 시뮬레이션은 성립하지 않습니다."
        right={
          isBottleneck ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-red-500/40 bg-red-500/10 text-red-500">
              병목 설비
            </span>
          ) : (
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${theme.chip}`}>
              여유 {Math.round((1 - share) * 100)}%
            </span>
          )
        }
      />
      <div className="p-3 space-y-3">
        {/* 수치 요약 */}
        <div className={`grid grid-cols-3 gap-1.5 rounded-lg border ${theme.panelBorder} ${theme.subtleBg} px-2 py-2 text-center`}>
          {[
            ['사이클 점유', `${Math.round(share * 100)}%`],
            ['가동 구간', `${mine.start.toFixed(1)}–${mine.end.toFixed(1)}s`],
            ['실작동/택트', `${busySec.toFixed(1)}s / ${lineTaktSec.toFixed(1)}s`],
          ].map(([k, v]) => (
            <div key={k}>
              <p className={`text-[10px] ${theme.textFaint}`}>{k}</p>
              <p className={`mt-0.5 text-[12px] font-semibold tabular-nums ${theme.textSecondary}`}>{v}</p>
            </div>
          ))}
        </div>

        {/* 전 설비 사이클 점유 간트 — 이 설비 강조, 병목 표시 */}
        <div className="space-y-1">
          {[...PROCESS_PHASES].sort((a, b) => durOf(b) - durOf(a)).map((p) => {
            const isMine = p.id === asset.id;
            const isBn = durOf(p) === maxDur;
            return (
              <div key={p.id} className="flex items-center gap-2" title={`${p.label} · ${durOf(p).toFixed(1)}s (${Math.round((durOf(p) / PROCESS_CYCLE_SEC) * 100)}%)`}>
                <span className={`w-[62px] shrink-0 text-[9px] truncate ${isMine ? `font-bold ${theme.textPrimary}` : theme.textFaint}`}>
                  {p.label}
                </span>
                <span className={`relative flex-1 h-2 rounded-sm overflow-hidden ${theme.trackBg}`}>
                  <span
                    className="absolute inset-y-0 rounded-sm"
                    style={{
                      left: pct(p.start),
                      width: pct(durOf(p)),
                      backgroundColor: isBn ? '#ef4444' : theme.accentHex,
                      opacity: isMine ? 1 : 0.3,
                    }}
                  />
                </span>
                <span className={`w-8 text-right text-[9px] tabular-nums ${isBn ? 'font-bold text-red-500' : theme.textGhost}`}>
                  {isBn ? '병목' : `${durOf(p).toFixed(1)}s`}
                </span>
              </div>
            );
          })}
        </div>

        <p className={`text-[10px] leading-relaxed ${theme.textGhost}`}>
          병목 설비의 가동 시간을 줄여야 라인 전체 택트가 짧아집니다. 나머지 설비는
          그만큼의 여유를 갖고 대기합니다.
        </p>
      </div>
    </Panel>
  );
};

const AssetDetailSidebar = ({
  theme, mode, asset, fault, lineStopped, onClose, now, memos, onAddMemo,
  memoAuthor = '-', canWriteMemo = true, memoHint, lineId, telemetry, lineTaktSec = PROCESS_CYCLE_SEC,
}) => {
  const [memoDraft, setMemoDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(true);

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

          {/* --- 병목 분석 --- */}
          {asset && <BottleneckPanel theme={theme} asset={asset} lineTaktSec={lineTaktSec} />}

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
