import { describe, it, expect } from 'vitest';
import {
    placeAnchoredMenu, placeCursorTooltip,
    MENU_GAP, MENU_MARGIN, MENU_MIN_HEIGHT, CURSOR_GAP,
} from '../../src/shared/ui/anchoredMenu.js';

const VIEWPORT = { width: 1280, height: 800 };

// 트리거 사각형을 간단히 만드는 도우미 (getBoundingClientRect 와 같은 필드만 쓴다)
const rect = (left, top, width = 100, height = 32) => ({
    left, top, width, height, right: left + width, bottom: top + height,
});

describe('placeAnchoredMenu — 기본 배치', () => {
    it('여유가 있으면 트리거 아래 왼쪽에 붙인다', () => {
        const pos = placeAnchoredMenu(rect(200, 60), { width: 240, height: 300 }, VIEWPORT);
        expect(pos.placement).toBe('below');
        expect(pos.left).toBe(200);
        expect(pos.top).toBe(60 + 32 + MENU_GAP);
    });

    it('짧은 메뉴는 위가 더 넓어도 아래에 그대로 둔다', () => {
        // 트리거가 화면 아래쪽(bottom 752) — 아래 여유는 34, 위 여유는 706 이다.
        // "위가 더 넓다"만 보면 뒤집히지만, 30px 메뉴는 아래에 들어가므로 아래에 남아야 한다.
        const pos = placeAnchoredMenu(rect(200, 720), { width: 240, height: 30 }, VIEWPORT);
        expect(pos.placement).toBe('below');
    });
});

describe('placeAnchoredMenu — 화면 밖으로 나가지 않는다', () => {
    it('오른쪽으로 넘치면 안쪽으로 당긴다', () => {
        const pos = placeAnchoredMenu(rect(1200, 60), { width: 240, height: 200 }, VIEWPORT);
        expect(pos.left).toBe(VIEWPORT.width - MENU_MARGIN - 240);
        expect(pos.left + 240).toBeLessThanOrEqual(VIEWPORT.width - MENU_MARGIN);
    });

    it('메뉴가 화면보다 넓으면 왼쪽 여백에 맞춘다 (음수 left 를 만들지 않는다)', () => {
        const pos = placeAnchoredMenu(rect(400, 60), { width: 2000, height: 200 }, VIEWPORT);
        expect(pos.left).toBe(MENU_MARGIN);
    });

    it('트리거가 화면 왼쪽 끝에 붙어 있어도 여백을 지킨다', () => {
        const pos = placeAnchoredMenu(rect(0, 60), { width: 240, height: 200 }, VIEWPORT);
        expect(pos.left).toBe(MENU_MARGIN);
    });
});

describe('placeAnchoredMenu — 뒤집기', () => {
    it('아래에 못 들어가고 위가 더 넓으면 위로 뒤집는다', () => {
        const pos = placeAnchoredMenu(rect(200, 700), { width: 240, height: 300 }, VIEWPORT);
        expect(pos.placement).toBe('above');
        expect(pos.top + 300).toBeLessThanOrEqual(700 - MENU_GAP + 1);
    });

    it('아래에 못 들어가지만 위가 더 좁으면 아래에 남는다', () => {
        // 트리거가 위쪽(top 40) — 위 여유는 26 뿐이므로 뒤집어도 나아지지 않는다
        const pos = placeAnchoredMenu(rect(200, 40), { width: 240, height: 900 }, VIEWPORT);
        expect(pos.placement).toBe('below');
    });

    it('위로 뒤집어도 상단 여백을 침범하지 않는다', () => {
        const pos = placeAnchoredMenu(rect(200, 780, 100, 20), { width: 240, height: 2000 }, VIEWPORT);
        expect(pos.placement).toBe('above');
        expect(pos.top).toBeGreaterThanOrEqual(MENU_MARGIN);
    });
});

describe('placeAnchoredMenu — maxHeight (잘리는 대신 스크롤)', () => {
    it('남은 높이를 maxHeight 로 돌려준다', () => {
        const pos = placeAnchoredMenu(rect(200, 60), { width: 240, height: 300 }, VIEWPORT);
        const spaceBelow = VIEWPORT.height - MENU_MARGIN - (92 + MENU_GAP);
        expect(pos.maxHeight).toBe(spaceBelow);
    });

    it('여유가 거의 없어도 최소 높이는 보장한다 — 0 이면 메뉴가 아예 안 보인다', () => {
        const pos = placeAnchoredMenu(rect(200, 780, 100, 18), { width: 240, height: 300 }, VIEWPORT);
        expect(pos.maxHeight).toBeGreaterThanOrEqual(MENU_MIN_HEIGHT);
    });

    it('메뉴가 화면보다 길면 maxHeight 가 메뉴 높이보다 작다 (스크롤이 걸린다)', () => {
        const pos = placeAnchoredMenu(rect(200, 60), { width: 240, height: 5000 }, VIEWPORT);
        expect(pos.maxHeight).toBeLessThan(5000);
        expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(VIEWPORT.height);
    });
});

describe('placeAnchoredMenu — 좌표는 항상 정수', () => {
    it('소수 좌표를 반올림해 돌려준다 (서브픽셀 좌표는 텍스트를 흐리게 만든다)', () => {
        const pos = placeAnchoredMenu(rect(200.4, 60.6), { width: 240.3, height: 300 }, VIEWPORT);
        expect(Number.isInteger(pos.top)).toBe(true);
        expect(Number.isInteger(pos.left)).toBe(true);
        expect(Number.isInteger(pos.maxHeight)).toBe(true);
    });
});

describe('placeCursorTooltip — 커서를 따라가지만 화면을 넘지 않는다', () => {
    const SIZE = { width: 200, height: 60 };

    it('여유가 있으면 커서 오른쪽 아래에 붙인다', () => {
        const pos = placeCursorTooltip({ x: 400, y: 300 }, SIZE, VIEWPORT);
        expect(pos).toEqual({ left: 400 + CURSOR_GAP, top: 300 + CURSOR_GAP });
    });

    it('오른쪽 끝에서는 커서 왼쪽으로 넘긴다', () => {
        const pos = placeCursorTooltip({ x: VIEWPORT.width - 20, y: 300 }, SIZE, VIEWPORT);
        expect(pos.left).toBe(VIEWPORT.width - 20 - CURSOR_GAP - SIZE.width);
        expect(pos.left + SIZE.width).toBeLessThan(VIEWPORT.width);
    });

    it('아래쪽 끝에서는 커서 위로 넘긴다', () => {
        const pos = placeCursorTooltip({ x: 400, y: VIEWPORT.height - 10 }, SIZE, VIEWPORT);
        expect(pos.top).toBe(VIEWPORT.height - 10 - CURSOR_GAP - SIZE.height);
        expect(pos.top + SIZE.height).toBeLessThan(VIEWPORT.height);
    });

    it('오른쪽 아래 모서리에서는 양쪽 모두 넘긴다', () => {
        const pos = placeCursorTooltip(
            { x: VIEWPORT.width - 5, y: VIEWPORT.height - 5 }, SIZE, VIEWPORT);
        expect(pos.left + SIZE.width).toBeLessThan(VIEWPORT.width);
        expect(pos.top + SIZE.height).toBeLessThan(VIEWPORT.height);
    });

    it('툴팁이 화면보다 크면 여백에 붙인다 (음수 좌표로 사라지지 않게)', () => {
        const pos = placeCursorTooltip({ x: 10, y: 10 }, { width: 3000, height: 2000 }, VIEWPORT);
        expect(pos.left).toBe(MENU_MARGIN);
        expect(pos.top).toBe(MENU_MARGIN);
    });

    it('크기를 아직 재지 못했으면(0) 그냥 커서 옆에 둔다', () => {
        const pos = placeCursorTooltip({ x: 400, y: 300 }, { width: 0, height: 0 }, VIEWPORT);
        expect(pos).toEqual({ left: 410, top: 310 });
    });
});
