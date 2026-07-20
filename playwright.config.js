import { defineConfig, devices } from '@playwright/test';

// E2E 스모크 테스트 설정 — vite dev 서버를 자동 기동
export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30_000,
    fullyParallel: false, // 단일 dev 서버 공유 — 순차 실행이 안정적
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: 'http://localhost:5173',
        ...devices['Desktop Chrome'],
        locale: 'ko-KR',
    },
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 60_000,
    },
});
