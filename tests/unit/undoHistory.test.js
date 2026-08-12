// 되돌리기 히스토리 판정 단위 테스트.
//
// 이 규칙이 틀리는 두 방향이 다 위험하다: 연속 입력이 칸마다 쌓이면 한 번의 드래그가
// 앞선 편집 20건을 밀어내고(되돌릴 것이 사라진다), 반대로 너무 합치면 서로 다른 조작이
// 한 칸에 묶여 되돌리기가 사용자가 지우지 않으려던 것까지 되돌린다.
import { describe, it, expect } from 'vitest';
import {
    initHistory, pushState, replacePresent, undoState, redoState,
    isSameGesture, MAX_HISTORY, COALESCE_WINDOW_MS,
} from '../../src/shared/hooks/undoHistory';

const present = (s) => s.history[s.index];

describe('pushState', () => {
    it('제스처 이름이 없으면 칸을 하나씩 늘린다', () => {
        let s = initHistory('a');
        s = pushState(s, 'b', null, 1000);
        s = pushState(s, 'c', null, 1010);
        expect(s.history).toEqual(['a', 'b', 'c']);
        expect(present(s)).toBe('c');
    });

    it('다시실행 꼬리는 새 편집이 잘라낸다', () => {
        let s = initHistory('a');
        s = pushState(s, 'b', null, 1000);
        s = undoState(s); // 'a'
        s = pushState(s, 'c', null, 1100);
        expect(s.history).toEqual(['a', 'c']);
        expect(s.index).toBe(1);
    });

    it('20칸을 넘으면 가장 오래된 것부터 버린다', () => {
        let s = initHistory(0);
        for (let i = 1; i <= 25; i++) s = pushState(s, i, null, 1000 + i);
        expect(s.history).toHaveLength(MAX_HISTORY);
        expect(present(s)).toBe(25);
        expect(s.history[0]).toBe(6); // 0~5 는 밀려나갔다
    });

    it('같은 제스처의 연속은 칸을 늘리지 않고 현재 칸을 덮는다', () => {
        // 슬라이더를 한 번 끄는 동안 이벤트가 20건 와도 칸은 하나다.
        let s = initHistory('start');
        s = pushState(s, 'edit', null, 1000); // 살아남아야 하는 앞선 편집
        for (let i = 0; i < 20; i++) s = pushState(s, `drag-${i}`, 'progress:t1', 2000 + i * 20);

        expect(s.history).toEqual(['start', 'edit', 'drag-19']);
        // 한 번 되돌리면 드래그 전으로, 두 번이면 그 앞의 편집까지
        s = undoState(s);
        expect(present(s)).toBe('edit');
        s = undoState(s);
        expect(present(s)).toBe('start');
    });

    it('제스처 이름이 다르면 합치지 않는다', () => {
        let s = initHistory('a');
        s = pushState(s, 'b', 'progress:t1', 1000);
        s = pushState(s, 'c', 'progress:t2', 1010); // 다른 작업의 슬라이더
        expect(s.history).toEqual(['a', 'b', 'c']);
    });

    it('창을 넘겨 도착한 같은 이름은 새 칸이다 — 두 번째 드래그를 되돌릴 수 있어야 한다', () => {
        let s = initHistory('a');
        s = pushState(s, 'b', 'progress:t1', 1000);
        s = pushState(s, 'c', 'progress:t1', 1000 + COALESCE_WINDOW_MS + 1);
        expect(s.history).toEqual(['a', 'b', 'c']);
    });

    it('연속 입력 중에도 창은 마지막 이벤트 기준으로 갱신된다', () => {
        // 창을 첫 이벤트 기준으로 재면 600ms 를 넘는 긴 드래그가 중간에 칸을 하나 더 만든다.
        let s = initHistory('a');
        s = pushState(s, 'b', 'g', 1000);
        for (let i = 1; i <= 5; i++) s = pushState(s, `b${i}`, 'g', 1000 + i * 500);
        expect(s.history).toEqual(['a', 'b5']);
    });
});

describe('isSameGesture', () => {
    it('이름이 없으면 절대 합치지 않는다', () => {
        const s = pushState(initHistory('a'), 'b', null, 1000);
        expect(isSameGesture(s, null, 1000)).toBe(false);
    });
});

describe('replacePresent / undoState / redoState', () => {
    it('silent 갱신은 칸을 늘리지 않는다', () => {
        let s = initHistory('a');
        s = pushState(s, 'b', null, 1000);
        s = replacePresent(s, 'b-collapsed');
        expect(s.history).toEqual(['a', 'b-collapsed']);
        expect(s.index).toBe(1);
    });

    it('silent 갱신은 진행 중인 제스처를 끊는다', () => {
        // 끊지 않으면 드래그 도중 들어온 접기 갱신 뒤의 이벤트가 그 칸을 덮어써서
        // 접기와 드래그가 한 칸에 섞인다.
        let s = initHistory('a');
        s = pushState(s, 'b', 'g', 1000);
        s = replacePresent(s, 'b2');
        s = pushState(s, 'c', 'g', 1010);
        expect(s.history).toEqual(['a', 'b2', 'c']);
    });

    it('되돌린 직후 도착한 같은 제스처는 되돌린 칸을 덮지 않는다', () => {
        // 창이 살아 있는 동안 이벤트가 하나 더 오면 되돌린 것이 되돌아오지 않는다.
        let s = initHistory('a');
        s = pushState(s, 'b', 'g', 1000);
        s = undoState(s);
        expect(present(s)).toBe('a');
        s = pushState(s, 'c', 'g', 1010);
        expect(s.history).toEqual(['a', 'c']);
        expect(present(s)).toBe('c');
        expect(present(undoState(s))).toBe('a');
    });

    it('바닥/천장에서는 상태를 그대로 돌려준다', () => {
        const s = initHistory('a');
        expect(undoState(s)).toBe(s);
        expect(redoState(s)).toBe(s);
    });

    it('되돌리기 → 다시실행 왕복', () => {
        let s = pushState(initHistory('a'), 'b', null, 1000);
        s = undoState(s);
        expect(present(s)).toBe('a');
        s = redoState(s);
        expect(present(s)).toBe('b');
    });
});
