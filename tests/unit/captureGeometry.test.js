import { describe, it, expect } from 'vitest';
import { captureHeight } from '../../src/features/timeline/captureGeometry.js';

const base = { headerHeight: 70, contentPadTop: 42, rowCount: 9, rowHeight: 40, scrollHeight: 1000 };

describe('captureHeight', () => {
    it('헤더 + 위쪽 여백 + 행 전부를 덮는다', () => {
        expect(captureHeight(base)).toBe(70 + 42 + 9 * 40);
    });

    it('위쪽 여백을 빼먹으면 마지막 행이 잘린다 — 여백만큼 더 크다', () => {
        // 이 차이가 곧 결함이었다. 여백 42px 는 행 높이 40px 보다 커서 한 행이 통째로 사라졌다.
        expect(captureHeight(base) - captureHeight({ ...base, contentPadTop: 0 })).toBe(42);
    });

    it('행이 없으면 실측 스크롤 높이로 물러선다', () => {
        expect(captureHeight({ ...base, rowCount: 0 })).toBe(1000);
        expect(captureHeight({ ...base, rowCount: 0, scrollHeight: undefined })).toBe(112);
    });

    it('행이 있으면 헤더+50 을 밑돌지 않는다', () => {
        expect(captureHeight({ ...base, contentPadTop: 0, rowCount: 1, rowHeight: 1 })).toBe(120);
    });
});
