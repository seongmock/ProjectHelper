// 실행 취소/다시 실행 기능 훅

import { useState, useCallback } from 'react';

export const useUndoRedo = (initialState) => {
    const [hookState, setHookState] = useState({
        history: [initialState],
        index: 0
    });

    const currentState = hookState.history[hookState.index];

    // 새 상태 추가 (실행 취소 히스토리 업데이트)
    const setState = useCallback((newState) => {
        console.log('[useUndoRedo] setState called', {
            newStateType: typeof newState,
            isFunction: typeof newState === 'function'
        });

        setHookState((prev) => {
            const { history, index } = prev;
            const currentState = history[index];
            const resolvedState = typeof newState === 'function' ? newState(currentState) : newState;

            console.log('[useUndoRedo] Adding to history', {
                currentIndex: index,
                historyLength: history.length,
                currentStateTaskCount: currentState?.length,
                newStateTaskCount: resolvedState?.length,
                currentStateFirstTask: currentState?.[0] ? {
                    id: currentState[0].id,
                    startDate: currentState[0].startDate,
                    endDate: currentState[0].endDate
                } : null,
                newStateFirstTask: resolvedState?.[0] ? {
                    id: resolvedState[0].id,
                    startDate: resolvedState[0].startDate,
                    endDate: resolvedState[0].endDate
                } : null
            });

            // 현재 인덱스 이후의 히스토리 제거 후 새 상태 추가
            const newHistory = [...history.slice(0, index + 1), resolvedState];

            // 최대 20개 히스토리 유지
            const slicedHistory = newHistory.slice(-20);

            // 새 인덱스는 마지막 항목 (length - 1)
            const newIndex = slicedHistory.length - 1;

            console.log('[useUndoRedo] History updated', {
                newIndex,
                newHistoryLength: slicedHistory.length,
                historySnapshot: slicedHistory.map((state, idx) => ({
                    index: idx,
                    taskCount: state?.length,
                    firstTask: state?.[0] ? {
                        id: state[0].id,
                        dates: `${state[0].startDate} ~ ${state[0].endDate}`
                    } : null
                }))
            });

            return {
                history: slicedHistory,
                index: newIndex
            };
        });
    }, []);

    // 실행 취소
    const undo = useCallback(() => {
        console.log('[useUndoRedo] undo called');
        setHookState((prev) => {
            console.log('[useUndoRedo] undo - before', {
                currentIndex: prev.index,
                historyLength: prev.history.length,
                canUndo: prev.index > 0
            });

            if (prev.index > 0) {
                const newIndex = prev.index - 1;
                console.log('[useUndoRedo] undo - moving to index', newIndex);
                return { ...prev, index: newIndex };
            }
            console.log('[useUndoRedo] undo - cannot undo (already at start)');
            return prev;
        });
    }, []);

    // 다시 실행
    const redo = useCallback(() => {
        console.log('[useUndoRedo] redo called');
        setHookState((prev) => {
            console.log('[useUndoRedo] redo - before', {
                currentIndex: prev.index,
                historyLength: prev.history.length,
                canRedo: prev.index < prev.history.length - 1
            });

            if (prev.index < prev.history.length - 1) {
                const newIndex = prev.index + 1;
                console.log('[useUndoRedo] redo - moving to index', newIndex);
                return { ...prev, index: newIndex };
            }
            console.log('[useUndoRedo] redo - cannot redo (already at end)');
            return prev;
        });
    }, []);

    const canUndo = hookState.index > 0;
    const canRedo = hookState.index < hookState.history.length - 1;

    console.log('[useUndoRedo] Current state', {
        currentIndex: hookState.index,
        historyLength: hookState.history.length,
        canUndo,
        canRedo
    });

    // 히스토리에 추가하지 않고 현재 상태만 업데이트 (드래그 중간 상태용)
    const setStateSilent = useCallback((newState) => {
        setHookState((prev) => {
            const { history, index } = prev;
            const currentState = history[index];
            const resolvedState = typeof newState === 'function' ? newState(currentState) : newState;

            // 현재 인덱스의 상태만 업데이트 (히스토리 추가 없음)
            const newHistory = [...history];
            newHistory[index] = resolvedState;

            return {
                history: newHistory,
                index: index
            };
        });
    }, []);

    return {
        state: currentState,
        setState,
        setStateSilent, // 드래그 중 등 임시 상태 업데이트용
        undo,
        redo,
        canUndo,
        canRedo,
    };
};
