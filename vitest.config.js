import { defineConfig } from 'vitest/config';

// 단위 테스트 설정.
// tests/e2e/** 는 Playwright가 담당하므로 반드시 제외한다 (둘 다 `test()` 를 쓴다).
export default defineConfig({
    test: {
        include: ['tests/unit/**/*.test.js'],
        environment: 'node',
        reporters: ['default'],
    },
});
