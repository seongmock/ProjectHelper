// 실행 취소/다시 실행 기능 훅

import { useState, useCallback } from 'react';

export const useUndoRedo = (initialState) => {
    const [history, setHistory] = useState([initialState]);
    const [currentIndex, setCurrentIndex] = useState(0);

    const currentState = history[currentIndex];

    // 새 상태 추가 (실행 취소 히스토리 업데이트)
    const setState = useCallback((newState) => {
        setHistory((prev) => {
            const currentState = prev[currentIndex];
            const resolvedState = typeof newState === 'function' ? newState(currentState) : newState;

            // 현재 인덱스 이후의 히스토리 제거 후 새 상태 추가
            const newHistory = [...prev.slice(0, currentIndex + 1), resolvedState];
            // 최대 20개 히스토리 유지
            return newHistory.slice(-20);
        });
        setCurrentIndex((prev) => Math.min(prev + 1, 19));
    }, [currentIndex]);

    // 실행 취소
    const undo = useCallback(() => {
        if (currentIndex > 0) {
            setCurrentIndex((prev) => prev - 1);
        }
    }, [currentIndex]);

    // 다시 실행
    const redo = useCallback(() => {
        if (currentIndex < history.length - 1) {
            setCurrentIndex((prev) => prev + 1);
        }
    }, [currentIndex, history.length]);

    const canUndo = currentIndex > 0;
    const canRedo = currentIndex < history.length - 1;

    return {
        state: currentState,
        setState,
        undo,
        redo,
        canUndo,
        canRedo,
    };
};
