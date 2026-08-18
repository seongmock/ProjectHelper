// 검색 중 접기는 **저장 데이터가 아니라 화면 상태**다(uiStore). 그래서 언제 버려지는지가
// 규칙이고, 그 규칙이 여기 있다 — 검색을 지우면 함께 사라져야 한다. 남으면 다음 검색이
// 이전 검색에서 접어 둔 가지를 접힌 채로 열어 보여 준다.
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from '../../src/stores/uiStore';

const store = () => useUiStore.getState();

describe('uiStore — searchCollapsedIds', () => {
    beforeEach(() => {
        useUiStore.setState({ searchQuery: '', searchCollapsedIds: new Set() });
    });

    it('토글은 넣고, 다시 누르면 뺀다', () => {
        store().toggleSearchCollapsed('t1');
        expect([...store().searchCollapsedIds]).toEqual(['t1']);
        store().toggleSearchCollapsed('t1');
        expect(store().searchCollapsedIds.size).toBe(0);
    });

    it('집합을 제자리에서 바꾸지 않는다 (useMemo 가 참조로 갱신을 안다)', () => {
        const before = store().searchCollapsedIds;
        store().toggleSearchCollapsed('t1');
        expect(store().searchCollapsedIds).not.toBe(before);
        expect(before.size).toBe(0);
    });

    it('질의를 바꾸는 동안에는 유지한다 (검색어를 다듬는 중이다)', () => {
        store().setSearchQuery('설');
        store().toggleSearchCollapsed('t1');
        store().setSearchQuery('설계');
        expect([...store().searchCollapsedIds]).toEqual(['t1']);
    });

    it('질의를 지우면 함께 버린다', () => {
        store().setSearchQuery('설계');
        store().toggleSearchCollapsed('t1');
        store().setSearchQuery('');
        expect(store().searchCollapsedIds.size).toBe(0);
    });

    it('공백만 남아도 버린다 (isSearching 의 판정과 같다)', () => {
        store().setSearchQuery('설계');
        store().toggleSearchCollapsed('t1');
        store().setSearchQuery('   ');
        expect(store().searchCollapsedIds.size).toBe(0);
    });

    it('프로젝트를 전환하면 비운다', () => {
        store().setSearchQuery('설계');
        store().toggleSearchCollapsed('t1');
        store().resetViewState();
        expect(store().searchCollapsedIds.size).toBe(0);
        expect(store().searchQuery).toBe('');
    });
});

// 뷰 모드는 저장 파일(내보내기)에도 들어 있어서 **모르는 값이 밖에서 들어올 수 있다.**
// '분할'을 제거한 뒤로 'split' 이 그런 값이고, 그대로 들어가면 App 의 두 조건 어느 쪽도
// 참이 아니라 본문이 빈 화면이 된다 — 그래서 게이트가 setViewMode 하나뿐이어야 한다.
describe('uiStore — viewMode 정규화', () => {
    beforeEach(() => {
        useUiStore.setState({ viewMode: 'timeline' });
    });

    it('아는 값은 그대로 둔다', () => {
        store().setViewMode('table');
        expect(store().viewMode).toBe('table');
        store().setViewMode('timeline');
        expect(store().viewMode).toBe('timeline');
    });

    it("제거된 'split' 은 타임라인으로 되돌린다 (빈 화면 방지)", () => {
        store().setViewMode('table');
        store().setViewMode('split');
        expect(store().viewMode).toBe('timeline');
    });

    it('모르는 값·빈 값도 타임라인으로 떨어진다', () => {
        for (const bad of ['gantt', '', null, undefined, 42]) {
            store().setViewMode('table');
            store().setViewMode(bad);
            expect(store().viewMode).toBe('timeline');
        }
    });
});
