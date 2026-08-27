/**
 * =============================================================================
 *  CCTV 영상 — 데모 mp4 루프와 실스트림(HLS)을 한 컴포넌트로
 * =============================================================================
 *  src 가 .m3u8 이면 실스트림(HLS)으로 재생한다:
 *   - hls.js 를 그때만 동적 로드한다 (데모 mp4 만 쓰는 배포는 번들 비용 0)
 *   - Safari 처럼 HLS 네이티브 지원 브라우저는 <video src> 로 그냥 재생
 *   - 라이브라서 loop 를 걸지 않고 LIVE 뱃지를 띄운다
 *  mp4(기본 데모)는 기존처럼 루프 재생. 어느 쪽이든 소스가 죽으면 검은 화면
 *  대신 '대신 이렇게 하세요' 안내를 보여준다.
 *
 *  variant:
 *   'pip'   — 뷰포트 좌하단 미니 화면 (absolute fill)
 *   'modal' — 확대 모달 본문
 */
import React, { useEffect, useRef, useState } from 'react';
import { VideoOff } from 'lucide-react';
import { assetUrl } from '../lib/baseUrl.js';

const GUIDE_TITLE = '영상 소스를 불러올 수 없습니다';
const GUIDE_BODY =
  '정적 데모 배포에는 CCTV 스트림 서버가 포함되지 않습니다. ' +
  '데모 영상 파일(public/cctv/*.mp4)을 함께 배포하거나, ' +
  '데이터 소스 설정의 CCTV 섹션에 RTSP→HLS 게이트웨이 주소(.m3u8)를 넣으세요.';

/** HLS 스트림 판별 — 쿼리스트링이 붙어도 잡는다 */
export const isHlsSrc = (src) => /\.m3u8($|\?)/i.test(src ?? '');

const CctvVideo = ({ src, variant = 'pip' }) => {
  const [failed, setFailed] = useState(false);
  const videoRef = useRef(null);
  const hls = isHlsSrc(src);
  /* 원격 절대 주소는 그대로, 저장소 내 상대 경로만 배포 base 를 붙인다 */
  const resolved = /^https?:\/\//i.test(src) ? src : assetUrl(src);

  /* 소스가 바뀌면 실패 상태를 리셋한다 — 설정에서 주소를 고치면 다시 시도 */
  useEffect(() => {
    setFailed(false);
  }, [src]);

  /* HLS 연결 — hls.js 동적 로드, 네이티브 지원(Safari)이면 그냥 src */
  useEffect(() => {
    if (!hls || failed) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = resolved;
      return undefined;
    }
    let instance = null;
    let cancelled = false;
    import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setFailed(true);
          return;
        }
        instance = new Hls({ maxBufferLength: 15 });
        instance.on(Hls.Events.ERROR, (_ev, data) => {
          /* 일시 오류는 hls.js 가 자체 복구한다 — 치명 오류만 안내로 전환 */
          if (data?.fatal) setFailed(true);
        });
        instance.loadSource(resolved);
        instance.attachMedia(video);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, [hls, resolved, failed]);

  if (failed) {
    if (variant === 'pip') {
      return (
        <div
          className="absolute inset-0 grid place-items-center bg-slate-950 px-2 text-center"
          title={GUIDE_BODY}
        >
          <div>
            <VideoOff className="w-4 h-4 mx-auto text-slate-500" />
            <p className="mt-1 text-[9px] leading-tight text-slate-400">{GUIDE_TITLE}</p>
            <p className="mt-0.5 text-[8px] leading-tight text-slate-600">스트림 서버 미연결 — 마우스를 올리면 안내</p>
          </div>
        </div>
      );
    }
    return (
      <div className="grid place-items-center bg-slate-950 h-[320px] px-10 text-center">
        <div>
          <VideoOff className="w-8 h-8 mx-auto text-slate-500" />
          <p className="mt-3 text-[13px] font-semibold text-slate-300">{GUIDE_TITLE}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{GUIDE_BODY}</p>
        </div>
      </div>
    );
  }

  const live = hls && (
    <span className="pointer-events-none absolute top-1.5 left-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600/90 text-[8px] font-bold text-white">
      <span className="w-1 h-1 rounded-full bg-white animate-pulse" /> LIVE
    </span>
  );

  if (variant === 'pip') {
    return (
      <>
        {live}
        <video
          ref={videoRef}
          /* HLS 는 attachMedia 가 소스를 물린다 — src 를 함께 주면 이중 로드 */
          src={hls ? undefined : resolved}
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay muted playsInline preload="auto"
          loop={!hls}
        />
      </>
    );
  }
  return (
    <div className="relative">
      {live}
      <video
        ref={videoRef}
        src={hls ? undefined : resolved}
        onError={() => setFailed(true)}
        className="w-full max-h-[70vh] object-contain"
        autoPlay muted playsInline controls
        loop={!hls}
      />
    </div>
  );
};

export default CctvVideo;
