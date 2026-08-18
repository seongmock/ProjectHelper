import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// CSS 커스텀 프로퍼티 회귀 게이트.
//
// 왜: `background: var(--color-bg)` 처럼 **정의된 적 없는 이름**을 쓰면 CSS 는 에러를
// 내지 않는다. "computed-value time 에 무효" 규칙에 따라 그 선언이 initial 값으로
// 계산되고, background 의 initial 은 **transparent** 다. 즉 메뉴 배경이 조용히 사라진다.
// (상속 속성인 color 는 initial 이 아니라 inherit 이라 더 눈에 안 띈다.)
// ProjectSwitcher 드롭다운과 ImportExportModal 이 실제로 이 상태였고, lint·빌드·단위
// 테스트 어디에도 걸리지 않았다. 이름을 대조하는 것이 유일한 자동 검사다.

const SRC = new URL('../../src/', import.meta.url).pathname;

// 런타임에 인라인 style 로 주입되는 이름들 — CSS 파일에는 정의가 없는 것이 정상이다.
const RUNTIME_INJECTED = new Set(['--status-color', '--swatch-color']);

function walk(dir, exts) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full, exts));
        else if (exts.some(e => entry.endsWith(e))) out.push(full);
    }
    return out;
}

const cssFiles = walk(SRC, ['.css']);
const styleFiles = walk(SRC, ['.css', '.jsx', '.js']);

// 정의는 사용과 **같은 파일 집합**에서 모은다. htmlExporter.js 는 내보낼 HTML 의 CSS 를
// 템플릿 문자열로 들고 있어서 :root 정의가 .js 안에 있다 — .css 만 읽으면 그 파일이
// 자기 안에서 정의하고 쓰는 이름이 전부 미정의로 잡힌다.
const defined = new Set();
for (const file of styleFiles) {
    const text = readFileSync(file, 'utf-8');
    for (const m of text.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) defined.add(m[1]);
}

// var(--name) 과 var(--name, fallback) 을 모두 잡는다. 폴백이 있는 쪽은 의도된
// 기본값이 있으므로 미정의여도 화면이 깨지지 않는다 → 따로 표시해 둔다.
const used = new Map(); // name -> { files:Set, hasFallbackOnly:boolean }
for (const file of styleFiles) {
    const text = readFileSync(file, 'utf-8');
    for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/g)) {
        const [, name, next] = m;
        const entry = used.get(name) ?? { files: new Set(), everBare: false };
        entry.files.add(file.slice(SRC.length));
        if (next === ')') entry.everBare = true;
        used.set(name, entry);
    }
}

describe('CSS 커스텀 프로퍼티 — 정의되지 않은 이름을 쓰지 않는다', () => {
    it('스캔이 실제로 파일을 읽었다', () => {
        expect(cssFiles.length).toBeGreaterThan(10);
        expect(defined.size).toBeGreaterThan(20);
        expect(used.size).toBeGreaterThan(20);
    });

    it('폴백 없이 쓰인 var() 는 모두 어딘가에 정의돼 있다', () => {
        const missing = [];
        for (const [name, { files, everBare }] of used) {
            if (!everBare || defined.has(name) || RUNTIME_INJECTED.has(name)) continue;
            missing.push(`${name} — ${[...files].join(', ')}`);
        }
        expect(missing, `정의되지 않은 CSS 변수:\n${missing.join('\n')}`).toEqual([]);
    });
});

describe('z-index 계단 — 팝업 계층은 토큰으로만 쓴다', () => {
    const LADDER = [
        '--z-timeline-bar', '--z-timeline-rollup', '--z-sticky-col', '--z-toolbar',
        '--z-header', '--z-timeline-marker', '--z-timeline-milestone',
        '--z-dropdown', '--z-modal', '--z-toast', '--z-tooltip',
    ];

    it('계단의 모든 토큰이 App.css 에 정의돼 있다', () => {
        const appCss = readFileSync(join(SRC, 'App.css'), 'utf-8');
        for (const token of LADDER) expect(appCss).toContain(`${token}:`);
    });

    it('계단 값이 순서대로 커진다', () => {
        const appCss = readFileSync(join(SRC, 'App.css'), 'utf-8');
        const values = LADDER.map(token => {
            const m = appCss.match(new RegExp(`${token}:\\s*(\\d+)`));
            return Number(m[1]);
        });
        for (let i = 1; i < values.length; i++) {
            expect(values[i], `${LADDER[i]} > ${LADDER[i - 1]}`).toBeGreaterThan(values[i - 1]);
        }
    });

    it('드롭다운·모달·토스트·툴팁은 숫자가 아니라 토큰을 쓴다', () => {
        // 이 네 계층은 서로를 덮는 관계라 숫자로 흩어지면 반드시 어긋난다.
        // (타임라인 내부의 999/1000 같은 값은 자기 쌓임 문맥 안이라 여기서 보지 않는다.)
        const files = [
            'shared/ui/Modal.css', 'shared/ui/Toast.css', 'shared/ui/Tooltip.css',
            'features/shell/DisplayOptionsMenu.css', 'features/projects/ProjectSwitcher.css',
            'features/shell/Header.css', 'features/shell/Toolbar.css',
        ];
        const offenders = [];
        for (const rel of files) {
            const text = readFileSync(join(SRC, rel), 'utf-8');
            for (const line of text.split('\n')) {
                const m = line.match(/^\s*z-index:\s*(\d+)/);
                if (m) offenders.push(`${rel}: ${line.trim()}`);
            }
        }
        expect(offenders, offenders.join('\n')).toEqual([]);
    });
});
