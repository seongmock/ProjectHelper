import { describe, it, expect } from 'vitest';
import {
    projectHue, projectColor, projectInitial, projectLightness, contrastWithWhite,
} from '../../src/features/projects/projectRail.js';

describe('projectHue / projectColor — id 로 결정되는 색', () => {
    it('같은 id 는 항상 같은 색이다', () => {
        expect(projectHue('default')).toBe(projectHue('default'));
        expect(projectColor('p-123')).toBe(projectColor('p-123'));
    });

    it('이름이 바뀌어도 색은 그대로다 (색의 입력은 id 뿐이다)', () => {
        // 레일에서 색은 위치와 함께 프로젝트를 외우는 단서다 — 이름 변경으로 바뀌면 안 된다
        expect(projectColor('p-1')).toBe(projectColor('p-1'));
    });

    it('가까운 id 들도 서로 다른 색을 받는다', () => {
        const hues = ['p1', 'p2', 'p3', 'p4', 'p5'].map(projectHue);
        expect(new Set(hues).size).toBe(hues.length);
    });

    it('항상 0~359 범위의 hue 다', () => {
        for (const id of ['', 'a', 'default', 'x'.repeat(200), '한글-아이디']) {
            const hue = projectHue(id);
            expect(hue).toBeGreaterThanOrEqual(0);
            expect(hue).toBeLessThan(360);
        }
    });

    it('빈 id 나 undefined 로도 유효한 색 문자열을 만든다', () => {
        expect(projectColor(undefined)).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
        expect(projectColor('')).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    });
});

describe('배지 밝기 — 흰 글자가 읽히는 값이어야 한다', () => {
    // 밝기를 모든 색조에 45% 로 고정했을 때 노랑(hue 60)은 흰 글자 대비 2.66:1 이었다.
    // 눈으로 보면 '노란 배지'라 결함처럼 보이지 않는다 — 그래서 숫자로 고정한다.
    it('모든 색조에서 흰 글자 대비가 4.5:1 이상이다', () => {
        const bad = [];
        for (let hue = 0; hue < 360; hue++) {
            const ratio = contrastWithWhite(hue, projectLightness(hue));
            if (ratio < 4.5) bad.push(`hue ${hue}: ${ratio.toFixed(2)}:1`);
        }
        expect(bad).toEqual([]);
    });

    it('필요한 색조만 어두워진다 — 대비가 이미 충분하면 45% 를 그대로 쓴다', () => {
        expect(projectLightness(240)).toBe(45);   // 파랑은 45% 로도 9:1
        expect(projectLightness(60)).toBeLessThan(45); // 노랑은 내려가야 한다
    });

    it('같은 id 는 여전히 같은 색이다 (밝기도 색조에서만 나온다)', () => {
        expect(projectColor('p-123')).toBe(projectColor('p-123'));
    });
});
describe('projectInitial — 이름의 첫 글자', () => {
    it('한글 이름의 첫 음절을 그대로 쓴다', () => {
        expect(projectInitial('기본 프로젝트')).toBe('기');
    });

    it('영문은 대문자로 올린다', () => {
        expect(projectInitial('alpha')).toBe('A');
    });

    it('앞뒤 공백은 무시한다', () => {
        expect(projectInitial('   베타 ')).toBe('베');
    });

    it('이모지를 반쪽으로 자르지 않는다', () => {
        expect(projectInitial('🚀 런치')).toBe('🚀');
    });

    it('이름이 비었으면 물음표를 준다 (빈 칸이면 클릭 대상이 사라진다)', () => {
        expect(projectInitial('')).toBe('?');
        expect(projectInitial('   ')).toBe('?');
        expect(projectInitial(undefined)).toBe('?');
    });
});
