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

// 저장 엔진을 그대로 넘긴다 — `PH_STORE=sqlite npx playwright test`.
// 왜 필요한가: 운영은 SQLite 인데(2026-08-20) 이 스위트는 JSON 엔진만 돌렸다.
// 미러 테스트(server/test/sqliteStore.test.js)는 저장소 계층까지만 맞춰 주므로,
// 409 충돌·스냅샷·삭제 시 의존성 프루닝 같은 **HTTP 경로**는 운영 엔진에서 돈 적이 없었다.
// 데이터 디렉토리를 엔진별로 나누는 것은 취향이 아니다: 한 디렉토리를 쓰면 지난 실행이
// 남긴 JSON 파일과 DB 가 나란히 있게 되고, 그 상태는 "엔진 설정이 빠졌다"와 구별되지 않는다.
const STORE = process.env.PH_STORE === 'sqlite' ? 'sqlite' : 'json';
const DATA_DIR = STORE === 'sqlite' ? '.tmp-e2e-data-sqlite' : '.tmp-e2e-data';

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
                PH_DATA_DIR: DATA_DIR,
                PH_STORE: STORE,
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
