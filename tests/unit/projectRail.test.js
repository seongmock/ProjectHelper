import { describe, it, expect } from 'vitest';
import { projectHue, projectColor, projectInitial } from '../../src/features/projects/projectRail.js';

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
