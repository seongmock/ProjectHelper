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
