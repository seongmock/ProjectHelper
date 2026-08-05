import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      usePolling: true,
    },
    host: true, // Listen on all local IPs
    proxy: {
      // 개발 모드에서 Express API 서버로 프록시.
      // 포트를 고정하면 호스트에서 3000번이 이미 점유된 경우(이 개발 호스트에서 실제로
      // 무관한 uvicorn 서비스가 쓰고 있다) 엉뚱한 서비스로 요청이 흘러가 404가 난다.
      '/api': process.env.VITE_API_TARGET || 'http://localhost:3000',
    },
  }
})
