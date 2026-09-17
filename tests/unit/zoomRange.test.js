// 구간 드래그 줌 / 숫자 입력이 함께 쓰는 배율 판정.
//
// 화면으로만 보면 "대충 그 근처로 확대됐다"가 통과한다 — 고른 구간의 **왼쪽 끝이
// 화면 왼쪽에 오는가**는 스크롤 위치까지 함께 계산해야 맞는다.
import { describe, it, expect } from 'vitest';
import { ZOOM_MIN, ZOOM_MAX, clampZoom, zoomToSelection } from '../../src/features/timeline/zoomRange';

describe('clampZoom', () => {
    it('한계 밖의 값은 거절이 아니라 한계값이다', () => {
        expect(clampZoom(0)).toBe(ZOOM_MIN);
        expect(clampZoom(999)).toBe(ZOOM_MAX);
        expect(clampZoom(1.5)).toBe(1.5);
    });

    it('숫자가 아니면 1 (입력란이 비어도 배율이 NaN 이 되지 않는다)', () => {
        expect(clampZoom(NaN)).toBe(1);
        expect(clampZoom(undefined)).toBe(1);
    });
});

describe('zoomToSelection', () => {
    const base = { contentWidth: 1000, zoomLevel: 1, viewportWidth: 1000 };

    it('절반을 고르면 배율이 두 배가 되고 그 왼쪽 끝이 화면 왼쪽에 온다', () => {
        const r = zoomToSelection({ ...base, x1: 250, x2: 750 });
        expect(r.zoomLevel).toBe(2);
        // 새 콘텐츠 폭 2000px 에서 원래 25% 지점 = 500px
        expect(r.scrollLeft).toBe(500);
    });

    it('오른쪽에서 왼쪽으로 끌어도 같다', () => {
        expect(zoomToSelection({ ...base, x1: 750, x2: 250 }))
            .toEqual(zoomToSelection({ ...base, x1: 250, x2: 750 }));
    });

    it('이미 확대돼 있으면 현재 배율에 곱한다', () => {
        const r = zoomToSelection({ x1: 0, x2: 500, contentWidth: 2000, zoomLevel: 2, viewportWidth: 1000 });
        expect(r.zoomLevel).toBe(8);
    });

    it('얇은 조각을 골라도 상한을 넘지 않는다 — 폭 수십만 px 은 브라우저를 멈춘다', () => {
        const r = zoomToSelection({ ...base, x1: 500, x2: 500.5 });
        expect(r.zoomLevel).toBe(ZOOM_MAX);
    });

    it('스크롤은 끝을 넘지 않는다', () => {
        const r = zoomToSelection({ ...base, x1: 900, x2: 1000 });
        expect(r.scrollLeft).toBeLessThanOrEqual(1000 * r.zoomLevel - 1000);
    });

    it('고를 것이 없으면(폭 0 · 실측 전) null', () => {
        expect(zoomToSelection({ ...base, x1: 300, x2: 300 })).toBeNull();
        expect(zoomToSelection({ ...base, contentWidth: 0, x1: 0, x2: 10 })).toBeNull();
        expect(zoomToSelection({ ...base, viewportWidth: 0, x1: 0, x2: 10 })).toBeNull();
    });

    it('범위 밖으로 끈 좌표는 콘텐츠 안으로 접는다', () => {
        const r = zoomToSelection({ ...base, x1: -400, x2: 500 });
        expect(r.zoomLevel).toBe(2);
        expect(r.scrollLeft).toBe(0);
    });
});
