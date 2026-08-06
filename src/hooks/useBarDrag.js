// 타임라인 바 / 마일스톤 드래그의 화면 상태(가이드선·드롭 대상 하이라이트)와
// 드롭 결과 적용. 무엇을 어떻게 바꿀지는 utils/timelineMutations.js 가 계산한다.
import { useCallback, useState } from 'react';
import { planRangeDrop, planMilestoneDrop } from '../utils/timelineMutations';

export function useBarDrag({ flatTasks, onUpdateTask, onUpdateTasks }) {
    const [guideLineX, setGuideLineX] = useState(null);
    const [dragTargetTaskId, setDragTargetTaskId] = useState(null);

    // 커서 Y 좌표가 어느 행 위인지. 행 높이는 CSS 가 정하므로 DOM 을 실측한다.
    const getTaskFromY = useCallback((clientY) => {
        const rows = document.querySelectorAll('.timeline-row[data-task-id]');
        for (const row of rows) {
            const rect = row.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                return flatTasks.find(t => t.id === row.getAttribute('data-task-id'));
            }
        }
        return null;
    }, [flatTasks]);

    // 여러 작업이 바뀌어도 undo 한 번에 되돌아가야 하므로 한 번에 넘긴다
    const applyUpdates = useCallback((updates) => {
        if (updates.length === 0) return;
        if (onUpdateTasks) onUpdateTasks(updates);
        else updates.forEach(u => onUpdateTask(u.taskId, u.updates, true));
    }, [onUpdateTask, onUpdateTasks]);

    const handleGuideMove = useCallback((offset) => setGuideLineX(offset), []);

    // 드래그 중 상태는 TimelineBar 가 로컬로 들고 있다. 여기서는 대상 행만 표시한다.
    const handleDragUpdate = useCallback((taskId, start, end, rangeId, clientY) => {
        if (clientY === undefined) return;
        const target = getTaskFromY(clientY);
        if (target) setDragTargetTaskId(target.id);
    }, [getTaskFromY]);

    const handleBarDragEnd = useCallback((taskId, finalStart, finalEnd, rangeId, clientY, isCopyMode) => {
        setDragTargetTaskId(null);

        const sourceTask = flatTasks.find(t => t.id === taskId);
        if (!sourceTask) return;

        const hovered = clientY === undefined ? null : getTaskFromY(clientY);
        applyUpdates(planRangeDrop({
            sourceTask,
            targetTask: hovered && hovered.id !== taskId ? hovered : null,
            rangeId,
            startDate: finalStart,
            endDate: finalEnd,
            isCopyMode,
        }));
    }, [flatTasks, getTaskFromY, applyUpdates]);

    const handleMilestoneDragMove = useCallback((clientY) => {
        const target = getTaskFromY(clientY);
        setDragTargetTaskId(target ? target.id : null);
    }, [getTaskFromY]);

    // 마일스톤은 세로 드래그 중 계속 갱신된 dragTargetTaskId 를 그대로 대상으로 쓴다
    const handleMilestoneDragEnd = useCallback((sourceTaskId, milestoneId, date, isCopyMode) => {
        const targetTaskId = dragTargetTaskId || sourceTaskId;
        setDragTargetTaskId(null);

        const sourceTask = flatTasks.find(t => t.id === sourceTaskId);
        const targetTask = flatTasks.find(t => t.id === targetTaskId);
        if (!sourceTask || !targetTask) return;

        applyUpdates(planMilestoneDrop({ sourceTask, targetTask, milestoneId, date, isCopyMode }));
    }, [flatTasks, dragTargetTaskId, applyUpdates]);

    return {
        guideLineX,
        dragTargetTaskId,
        handleGuideMove,
        handleDragUpdate,
        handleBarDragEnd,
        handleMilestoneDragMove,
        handleMilestoneDragEnd,
    };
}
