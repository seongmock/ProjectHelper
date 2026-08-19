import { defineConfig } from 'vitest/config';

// 단위 테스트 설정.
// tests/e2e/** 는 Playwright가 담당하므로 반드시 제외한다 (둘 다 `test()` 를 쓴다).
export default defineConfig({
    test: {
        include: ['tests/unit/**/*.test.js'],
        environment: 'node',
        reporters: ['default'],

        // 커버리지는 **도메인 코어에만** 건다. 전체 src 에 걸면 컴포넌트가 숫자를 눌러
        // 임계값이 의미 없는 수준까지 내려가고, 그러면 게이트가 아니라 장식이 된다.
        //
        // 여기서 재는 것은 "순수 모듈" — 판단이 들어 있고 렌더러 없이 부를 수 있는 코드다.
        // 빠지는 것은 두 부류이고 둘 다 의도적이다:
        //   · `*.jsx` — 그리는 코드. E2E(105건)가 실제 브라우저에서 본다.
        //   · `use*.js` — React 훅. 렌더러가 있어야 부를 수 있어(@testing-library 도입이
        //     전제) 여기서 재면 0% 로 계속 남는다. 마찬가지로 E2E 담당이다.
        // 훅에서 판단을 떼어 순수 모듈로 옮기는 것이 이 프로젝트의 방식이다
        // (undoHistory / syncStatus / anchoredMenu / rollupBars …) — 그 규칙을 숫자로 굳힌다.
        coverage: {
            provider: 'v8',
            reporter: ['text-summary', 'lcov'],
            include: [
                'src/utils/**/*.js',
                'src/stores/**/*.js',
                'src/shared/**/*.js',
                'src/features/**/*.js',
            ],
            exclude: ['src/**/use*.js'],
            // 지금 수치(97/90/81/97)보다 조금 아래에 둔 **바닥**이다. 올리는 것은 환영,
            // 내리려면 왜 내리는지 커밋 메시지에 적어라 — 조용히 내려가면 게이트가 사라진다.
            //
            // functions 만 유독 낮은 것은 미달이 아니라 v8 의 세는 방식이다: 객체 안의
            // 화살표 함수 하나하나를 함수로 세므로 zustand 스토어의 세터 20여 개(uiStore
            // 21%)와 스타일 헬퍼가 숫자를 끌어내린다. 그것들은 E2E 가 실제로 누른다.
            thresholds: {
                statements: 95,
                branches: 88,
                functions: 80,
                lines: 95,
            },
        },
    },
});
