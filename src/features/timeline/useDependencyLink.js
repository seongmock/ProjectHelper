// 의존성 연결 모드 — "연결 시작"을 누른 뒤 다음 클릭 대상에 화살표를 잇는다.
//
// 연결의 단위는 기간(timeRange)과 마일스톤이다. 작업 단위 의존성(task.dependencies)은
// 레거시라 새로 만들지는 않지만, 남아 있는 데이터를 끊을 수는 있어야 한다.
import { useCallback, useEffect, useState } from 'react';

export function useDependencyLink({ flatTasks, onUpdateTask, onSelectTask, toast }) {
    const [isLinkingMode, setIsLinkingMode] = useState(false);
    const [linkSourceId, setLinkSourceId] = useState(null);

    const startLinking = useCallback((id) => {
        setIsLinkingMode(true);
        setLinkSourceId(id);
    }, []);

    const cancelLinking = useCallback(() => {
        setIsLinkingMode(false);
        setLinkSourceId(null);
    }, []);

    useEffect(() => {
        if (!isLinkingMode) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') cancelLinking();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isLinkingMode, cancelLinking]);

    // 작업/기간 클릭. 연결 모드가 아니면 그냥 선택이다.
    const handleTaskClick = useCallback((taskId, rangeId) => {
        if (!isLinkingMode) {
            onSelectTask(taskId);
            return;
        }

        // 자기 자신으로는 연결하지 않는다. 단 같은 작업이라도 *다른 기간* 이면 허용한다.
        if (rangeId ? rangeId === linkSourceId : taskId === linkSourceId) {
            cancelLinking();
            return;
        }

        const targetTask = flatTasks.find(t => t.id === taskId);
        if (!targetTask) return;

        const targetRange = rangeId ? (targetTask.timeRanges || []).find(r => r.id === rangeId) : null;
        const currentDeps = (targetRange ? targetRange.dependencies : targetTask.dependencies) || [];

        if (currentDeps.includes(linkSourceId)) {
            toast.warn('이미 연결된 항목입니다.');
            cancelLinking();
            return;
        }

        if (targetRange) {
            onUpdateTask(taskId, {
                timeRanges: targetTask.timeRanges.map(r =>
                    r.id === rangeId ? { ...r, dependencies: [...currentDeps, linkSourceId] } : r
                ),
            });
        } else {
            onUpdateTask(taskId, { dependencies: [...currentDeps, linkSourceId] });
        }
        cancelLinking();
    }, [isLinkingMode, linkSourceId, flatTasks, onUpdateTask, onSelectTask, toast, cancelLinking]);

    // 마일스톤 클릭 — 연결 모드일 때만 의미가 있다 (선택 개념이 없다)
    const handleMilestoneClick = useCallback((e, milestone) => {
        e.stopPropagation();
        if (!isLinkingMode) return;

        if (milestone.id === linkSourceId) {
            cancelLinking();
            return;
        }

        const parentTask = flatTasks.find(t => (t.milestones || []).some(m => m.id === milestone.id));
        if (!parentTask) return;

        const currentDeps = milestone.dependencies || [];
        if (currentDeps.includes(linkSourceId)) {
            toast.warn('이미 연결된 마일스톤입니다.');
            cancelLinking();
            return;
        }

        onUpdateTask(parentTask.id, {
            milestones: parentTask.milestones.map(m =>
                m.id === milestone.id ? { ...m, dependencies: [...currentDeps, linkSourceId] } : m
            ),
        });
        cancelLinking();
    }, [isLinkingMode, linkSourceId, flatTasks, onUpdateTask, toast, cancelLinking]);

    // 연결 끊기. targetId 는 작업 id 일 수도 마일스톤 id 일 수도 있다.
    // 갱신된 마일스톤을 돌려주면 호출부가 열려 있는 팝오버를 다시 그린다.
    const removeDependency = useCallback((targetId, dependencyId) => {
        const targetTask = flatTasks.find(t => t.id === targetId);
        if (targetTask) {
            onUpdateTask(targetId, {
                dependencies: (targetTask.dependencies || []).filter(id => id !== dependencyId),
            });
            return null;
        }

        const parentTask = flatTasks.find(t => (t.milestones || []).some(m => m.id === targetId));
        if (!parentTask) return null;

        const milestones = parentTask.milestones.map(m =>
            m.id === targetId
                ? { ...m, dependencies: (m.dependencies || []).filter(id => id !== dependencyId) }
                : m
        );
        onUpdateTask(parentTask.id, { milestones });
        return milestones.find(m => m.id === targetId);
    }, [flatTasks, onUpdateTask]);

    return { isLinkingMode, startLinking, handleTaskClick, handleMilestoneClick, removeDependency };
}
