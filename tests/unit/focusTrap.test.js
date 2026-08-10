// 모달 포커스 가두기 판정 단위 테스트.
//
// 이 규칙이 틀리면 두 방향으로 조용히 망가진다: 느슨하면 Tab 이 배경으로 새서
// 보이지 않는 화면이 조작되고, 과하면 모달 안에서 Tab 이 아예 움직이지 않는다.
// 후자는 "가둬 놨다"는 착각을 주기 때문에 더 나쁘다 — 경계에서만 개입해야 한다.
import { describe, it, expect } from 'vitest';
import { nextTrapIndex } from '../../src/shared/ui/focusTrap';

describe('nextTrapIndex', () => {
    it('후보 사이의 이동은 가로채지 않는다 (null)', () => {
        expect(nextTrapIndex(4, 0, false)).toBe(null);
        expect(nextTrapIndex(4, 2, false)).toBe(null);
        expect(nextTrapIndex(4, 3, true)).toBe(null);
        expect(nextTrapIndex(4, 1, true)).toBe(null);
    });

    it('마지막에서 Tab 은 첫 번째로 돈다', () => {
        expect(nextTrapIndex(4, 3, false)).toBe(0);
        expect(nextTrapIndex(1, 0, false)).toBe(0);
    });

    it('첫 번째에서 Shift+Tab 은 마지막으로 돈다', () => {
        expect(nextTrapIndex(4, 0, true)).toBe(3);
        expect(nextTrapIndex(1, 0, true)).toBe(0);
    });

    it('포커스가 후보 밖이면(컨테이너 자신) 진행 방향의 끝을 잡는다', () => {
        expect(nextTrapIndex(4, -1, false)).toBe(0);
        expect(nextTrapIndex(4, -1, true)).toBe(3);
    });

    it('받을 것이 하나도 없으면 컨테이너(-1) — 배경으로 내보내지 않는다', () => {
        expect(nextTrapIndex(0, -1, false)).toBe(-1);
        expect(nextTrapIndex(0, -1, true)).toBe(-1);
    });
});
