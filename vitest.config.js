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
            // 지금 수치보다 조금 아래에 둔 **바닥**이다. 올리는 것은 환영, 내리려면 왜 내리는지
            // 커밋 메시지에 적어라 — 조용히 내려가면 게이트가 사라진다.
            //
            // **2026-10-14 vitest 3 → 4 에서 다시 정했다**(보안 권고 tinypool·@vitest/mocker 해소).
            // vitest 4 의 v8 커버리지는 줄이 아니라 **실제 구문**을 센다(같은 코드의 구문 수가 4585 → 1858).
            // 그래서 같은 코드, 같은 테스트가 구문·줄 97.9% → 94.2%, 함수 87.7% → 92.0% 로 읽힌다 — 덜 테스트된
            // 것이 아니라 자가 바뀌었다(두 버전으로 같은 커밋을 재서 확인). 측정 방식이 강제한 것만 바꿨다:
            //   statements·lines 95 → 92 (새 방식 실측 94.2 의 약 2 아래 — 예전과 같은 여유)
            //   functions       80 → 90 (올렸다 — 예전 방식은 객체 안 화살표 함수를 하나하나 세서
            //                           zustand 세터 등이 숫자를 끌어내렸다. 새 방식 실측 92.0)
            //   branches        88 그대로 (새 방식 실측 88.7)
            thresholds: {
                statements: 92,
                branches: 88,
                functions: 90,
                lines: 92,
            },
        },
    },
});
