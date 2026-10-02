// 차트 테마 레지스트리 — 미니멀 테마가 쓰는 필드(팔레트·색 매핑)와, 기존 테마가 그 필드
// 때문에 바뀌지 않는다는 것.
import { describe, it, expect } from 'vitest';
import { THEMES, getTheme, getStatusColor, getStatusStyles, themeColor, STATUS_STYLES } from '../../src/themes/index.js';

describe('미니멀 테마', () => {
    it('등록돼 있고 다크 모드를 무시한다', () => {
        expect(THEMES.map(t => t.id)).toContain('minimal');
        expect(getTheme('minimal').forceLight).toBe(true);
        expect(getTheme('minimal').milestoneDateLabels).toBe(true);
    });

    it('상태 색상은 테마 팔레트를 쓰고, 범례 목록도 같은 색이다', () => {
        expect(getStatusColor('active', 'minimal')).toBe('#f0b429');
        expect(getStatusColor('done', 'minimal')).toBe('#3a9a5b');
        expect(getStatusStyles('minimal').map(s => s.id)).toEqual(STATUS_STYLES.map(s => s.id));
        expect(getStatusStyles('minimal').find(s => s.id === 'overdue').color).toBe('#d64545');
    });

    it('트래커가 저장한 색을 대소문자 무시로 토큰 색에 매핑하고, 나머지는 그대로 둔다', () => {
        expect(themeColor('#4A90E2', 'minimal')).toBe('#6b8fd6');
        expect(themeColor('#4a90e2', 'minimal')).toBe('#6b8fd6');
        expect(themeColor('#123456', 'minimal')).toBe('#123456');
        expect(themeColor(undefined, 'minimal')).toBeUndefined();
    });
});

describe('기존 테마는 그대로다', () => {
    it.each(['default', 'lg', undefined, 'no-such-theme'])('%s: 기본 팔레트·색 매핑 없음', (id) => {
        expect(getStatusColor('active', id)).toBe(STATUS_STYLES.find(s => s.id === 'active').color);
        expect(themeColor('#4A90E2', id)).toBe('#4A90E2');
        expect(getTheme(id).milestoneDateLabels).toBeFalsy();
    });
});
