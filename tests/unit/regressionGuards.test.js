// 재발 방지 — 2026-10 레드팀·사용자 보고에서 **두 번 이상 생기거나 아무 테스트도 못 잡은** 결함 종류를 기계로 막는다.
// 규칙의 서술과 이유는 CLAUDE.md "재발 방지 규칙" 절에 있다. 여기에는 값싸게 자동화되는 것만 둔다.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildCommands } from '../../src/features/shell/commandPalette';
import { SETTING_DEFAULTS } from '../../src/stores/settingsSchema';

const ROOT = new URL('../../', import.meta.url).pathname;
const walk = (dir) => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
});

describe('켜고 끄는 설정은 전부 명령 팔레트에 있다', () => {
    // 표시 옵션을 셋 추가하면서 메뉴(DisplayOptionsMenu)에만 넣고 팔레트(commandPalette.js)에는 넣지 않았다 —
    // 팔레트로 "의존성", "단계" 를 찾으면 아무것도 없었다(레드팀 2차 C-19). 팔레트는 기능의 색인이라
    // 빠진 것은 "없는 기능"으로 읽힌다. 새 불리언 설정은 팔레트에도 넣거나, 넣지 않을 이유를 여기 적는다.
    const NOT_IN_PALETTE = {
        railExpanded: '레일 자체의 접기 버튼이 늘 화면에 있다 — 팔레트로 찾을 일이 없다',
    };

    it('불리언 설정마다 그것을 뒤집는 명령이 있다', () => {
        const toggled = new Set();
        const handlers = new Proxy({}, {
            get: (_, name) => (name === 'toggleSetting' ? (key) => toggled.add(key) : vi.fn()),
        });
        const commands = buildCommands({
            viewMode: 'timeline', settings: { ...SETTING_DEFAULTS, darkMode: false },
            canUndo: false, canRedo: false, projects: [], activeProjectId: 'default', handlers,
        });
        commands.forEach(c => c.run());

        const booleans = Object.keys(SETTING_DEFAULTS)
            .filter(k => typeof SETTING_DEFAULTS[k] === 'boolean' || k === 'darkMode');
        const missing = booleans.filter(k => !toggled.has(k) && !NOT_IN_PALETTE[k]);
        expect(missing, `팔레트에 없는 설정: ${missing.join(', ')}`).toEqual([]);
    });
});

describe('캡처 영역에는 html2canvas 가 그리지 못하는 CSS 를 쓰지 않는다', () => {
    // '이미지로 복사'는 html2canvas 로 DOM 을 다시 그린다. 화면에서 멀쩡한 것이 이미지에서는 깨지고, 어떤
    // E2E 도 픽셀을 보지 않으면 아무도 모른다(실제로 두 번):
    //   · color-mix() — 계산값 color(srgb …) 를 파싱하지 못해 **캡처 전체가 예외로 실패**했다(미니멀 테마)
    //   · clip-path — 무시된다. CSS 로 깎은 모양은 사각형으로 찍힌다(그래서 쉐브론·LG 화살표는 SVG 다)
    // 다른 함정(transform 으로 옮긴 상자의 자식 어긋남, % 높이 SVG)은 패턴으로 잡기 어려워 E2E 가 픽셀을 본다.
    // HTML 내보내기는 브라우저가 그리므로 대상이 아니다.
    const files = [
        ...walk(join(ROOT, 'src/features/timeline')),
        join(ROOT, 'src/themes/themes.css'),
    ].filter(f => /\.(css|jsx?)$/.test(f));
    // 주석 안의 언급은 허용한다(그 금지를 설명하는 주석이 이 단어를 쓴다)
    const code = (text) => text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    it.each([
        ['color-mix(', /color-mix\(/],
        ['clip-path', /clip-?path\s*:/i],
    ])('%s 금지', (_, pattern) => {
        const hits = files.filter(f => pattern.test(code(readFileSync(f, 'utf8')))).map(f => relative(ROOT, f));
        expect(hits).toEqual([]);
    });
});
