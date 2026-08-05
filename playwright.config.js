import { defineConfig, devices } from '@playwright/test';

// E2E 설정 — API 서버와 vite dev 서버를 모두 자동 기동한다.
//
// 왜 API 서버까지 띄우는가: 이전에는 API 서버를 수동으로 띄우지 않으면 8건이
// test.skip() 으로 조용히 사라지고 1건은 404로 하드 실패했다(19 pass/1 fail/8 skip).
// "테스트 통과"가 무엇을 보증하는지 알 수 없는 상태였다. 이제 28건이 항상 실행된다.
//
// 포트 3101: 이 개발 호스트의 3000번은 무관한 uvicorn 서비스가 점유 중이다.
const API_PORT = process.env.PH_TEST_API_PORT || '3101';
const API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30_000,
    fullyParallel: false, // 단일 dev 서버 + 단일 데이터 저장소 공유 — 순차 실행이 안정적
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: 'http://localhost:5173',
        ...devices['Desktop Chrome'],
        locale: 'ko-KR',
    },
    webServer: [
        {
            // PH_DATA_DIR 로 격리 — 테스트가 개발/운영 데이터를 건드리지 않는다
            command: 'node server/index.js',
            env: {
                PORT: API_PORT,
                PH_DATA_DIR: '.tmp-e2e-data',
                LOG_LEVEL: 'warn',
            },
            url: `${API_URL}/api/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
        },
        {
            command: 'npm run dev',
            env: { VITE_API_TARGET: API_URL },
            url: 'http://localhost:5173',
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
        },
    ],
});
