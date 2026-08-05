import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

// ESLint 9 flat config.
// 실사 시점에 린터가 아예 없었다. 규칙은 '실제 버그를 잡는 것'에 집중하고
// 스타일 논쟁은 넣지 않는다 (기존 코드를 대량 수정하게 만들면 도입이 실패한다).
export default [
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'server/node_modules/**',
            'mcp/node_modules/**',
            'backups/**',
            'test-results/**',
            'playwright-report/**',
            '.serena/**',
        ],
    },

    // ── 프론트엔드 (ESM + 브라우저 + React) ──────────
    {
        files: ['src/**/*.{js,jsx}'],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: globals.browser,
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
        plugins: {
            react,
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        settings: { react: { version: 'detect' } },
        rules: {
            ...js.configs.recommended.rules,
            // JSX 안에서 쓰인 식별자를 '사용됨'으로 인식시킨다.
            // 이게 없으면 컴포넌트 import 전부가 no-unused-vars 오탐이 되고,
            // 린터가 늑대를 외치기 시작하면 아무도 보지 않게 된다.
            'react/jsx-uses-vars': 'error',
            'react/jsx-uses-react': 'error',
            // 훅 규칙 위반은 실제 런타임 버그가 된다 — error 로 둔다
            'react-hooks/rules-of-hooks': 'error',
            // 의존성 누락은 stale closure 버그의 주요 원인. 다만 기존 코드에
            // 의도적 생략(eslint-disable 주석 포함)이 있어 warn 으로 시작한다.
            'react-hooks/exhaustive-deps': 'warn',
            'react-refresh/only-export-components': 'off',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // 실수로 남긴 디버깅 코드 방지
            'no-debugger': 'error',
            // alert() 금지는 이 프로젝트의 규약이다 (toast 를 쓴다)
            'no-restricted-globals': ['error', { name: 'alert', message: 'toast.* 를 사용하라' }],
            eqeqeq: ['warn', 'smart'],
        },
    },

    // ── 서버 (CommonJS + Node) ───────────────────────
    {
        files: ['server/**/*.js', 'mcp/**/*.js', 'scripts/**/*.{js,mjs,cjs}'],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: globals.node,
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-unused-vars': ['warn', { argsIgnorePattern: '^(_|next$)' }],
            'no-debugger': 'error',
        },
    },

    // mcp/ 와 scripts/ 는 ESM 이다
    {
        files: ['mcp/**/*.js', 'scripts/**/*.mjs'],
        languageOptions: { sourceType: 'module' },
    },

    // ── 테스트 ───────────────────────────────────────
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.node, ...globals.browser },
        },
        rules: { ...js.configs.recommended.rules },
    },
    {
        files: ['server/test/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: globals.node,
        },
        rules: { ...js.configs.recommended.rules },
    },

    // 설정 파일
    {
        files: ['*.config.js', 'vite.config.js', 'vitest.config.js', 'playwright.config.js', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: globals.node,
        },
    },
];
