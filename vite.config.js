import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/* PORT 가 주어지면 그 포트로 띄운다(에이전트/CI 가 포트를 배정하는 경우). 평소엔 5173. */
const port = Number(process.env.PORT) || 5173;

export default defineConfig({
  /* 상대 경로 빌드 — 도메인 루트든 GitHub Pages 하위 경로든 그대로 동작한다.
     저장소 이름을 여기 박지 않는다(이름이 바뀌면 깨진다). 코드의 자산 주소는
     src/lib/baseUrl.js 의 assetUrl 이 이 base 를 실행 시점에 붙인다. */
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port,
    /* 포트를 배정받아 띄운 경우엔 브라우저 창을 자동으로 열지 않는다 */
    open: !process.env.PORT,
  },
});
