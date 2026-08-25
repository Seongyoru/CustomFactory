/**
 * =============================================================================
 *  CCTV 영상 — 소스가 없을 때 기능을 숨기지 않고 '대신 이렇게 하세요'로 안내
 * =============================================================================
 *  정적 배포(GitHub Pages 등)에는 CCTV 스트림 서버가 없다. 데모 영상 파일이
 *  함께 배포되면 그대로 재생되고, 파일이 빠졌거나 실스트림 주소가 죽어 있으면
 *  검은 화면 대신 조치 방법을 보여준다.
 *
 *  variant:
 *   'pip'   — 뷰포트 좌하단 미니 화면 (absolute fill)
 *   'modal' — 확대 모달 본문
 */
import React, { useState } from 'react';
import { VideoOff } from 'lucide-react';
import { assetUrl } from '../lib/baseUrl.js';

const GUIDE_TITLE = '영상 소스를 불러올 수 없습니다';
const GUIDE_BODY =
  '정적 데모 배포에는 CCTV 스트림 서버가 포함되지 않습니다. ' +
  '데모 영상 파일(public/cctv/*.mp4)을 함께 배포하거나, ' +
  '사내 배포에서는 RTSP/HLS 게이트웨이 주소로 교체하세요.';

const CctvVideo = ({ src, variant = 'pip' }) => {
  const [failed, setFailed] = useState(false);

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

  if (variant === 'pip') {
    return (
      <video
        src={assetUrl(src)}
        onError={() => setFailed(true)}
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay muted loop playsInline preload="auto"
      />
    );
  }
  return (
    <video
      src={assetUrl(src)}
      onError={() => setFailed(true)}
      className="w-full max-h-[70vh] object-contain"
      autoPlay muted loop playsInline controls
    />
  );
};

export default CctvVideo;
