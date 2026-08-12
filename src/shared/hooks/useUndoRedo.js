// 실행 취소/다시 실행 기능 훅
//
// 판정(칸을 늘릴지 덮을지·20칸 상한·제스처 병합)은 전부 undoHistory.js 의 순수 함수가
// 한다. 여기서는 함수형 업데이터를 현재 상태로 풀어 주는 일만 한다.

import { useState, useCallback } from 'react';
import { initHistory, pushState, replacePresent, undoState, redoState } from './undoHistory';

export const useUndoRedo = (initialState) => {
    const [hookState, setHookState] = useState(() => initHistory(initialState));

    const currentState = hookState.history[hookState.index];

    // 새 상태 추가 (실행 취소 히스토리 업데이트).
    // gestureKey: 연속 입력을 한 칸으로 묶고 싶을 때 그 제스처의 이름. 슬라이더 드래그처럼
    // "끝났다"는 시점이 없는 컨트롤이 쓴다 — 자세한 근거는 undoHistory.js 머리말.
    const setState = useCallback((newState, gestureKey = null) => {
        setHookState((prev) => {
            const resolved = typeof newState === 'function'
                ? newState(prev.history[prev.index])
                : newState;
            return pushState(prev, resolved, gestureKey);
        });
    }, []);

    // 실행 취소
    const undo = useCallback(() => setHookState(undoState), []);

    // 다시 실행
    const redo = useCallback(() => setHookState(redoState), []);

    // 히스토리 전체 교체 — 프로젝트 전환 시 이전 프로젝트 상태로의 undo를 차단
    const reset = useCallback((newState) => setHookState(initHistory(newState)), []);

    const canUndo = hookState.index > 0;
    const canRedo = hookState.index < hookState.history.length - 1;

    // 히스토리에 추가하지 않고 현재 상태만 업데이트 (드래그 중간 상태용)
    const setStateSilent = useCallback((newState) => {
        setHookState((prev) => {
            const resolved = typeof newState === 'function'
                ? newState(prev.history[prev.index])
                : newState;
            return replacePresent(prev, resolved);
        });
    }, []);

    return {
        state: currentState,
        setState,
        setStateSilent, // 드래그 중 등 임시 상태 업데이트용
        reset, // 프로젝트 전환 시 히스토리 초기화
        undo,
        redo,
        canUndo,
        canRedo,
    };
};
