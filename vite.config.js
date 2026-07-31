import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/* PORT 가 주어지면 그 포트로 띄운다(에이전트/CI 가 포트를 배정하는 경우). 평소엔 5173. */
const port = Number(process.env.PORT) || 5173;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port,
    /* 포트를 배정받아 띄운 경우엔 브라우저 창을 자동으로 열지 않는다 */
    open: !process.env.PORT,
  },
});
