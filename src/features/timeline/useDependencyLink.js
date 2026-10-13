// 의존성 연결 모드 — "연결 시작"을 누른 뒤 다음 클릭 대상에 화살표를 잇는다.
//
// 연결의 단위는 기간(timeRange)과 마일스톤이다. 작업 단위 의존성(task.dependencies)은
// 레거시라 새로 만들지는 않지만, 남아 있는 데이터를 끊을 수는 있어야 한다.
import { useCallback, useEffect, useState } from 'react';
import { wouldCreateDependencyCycle } from '../../utils/taskTree';

export function useDependencyLink({
    flatTasks, onUpdateTask, onSelectTask, toast, dependencySuccessors,
}) {
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

    // 연결이 끝났다는 것을 말한다. 화살표를 꺼 두었거나 상대가 화면 밖이면 차트에 아무 변화가
    // 없어서, 연결이 됐는지 인스펙터 목록을 열어 봐야만 알 수 있었다.
    const announce = useCallback((targetName) => {
        const owner = flatTasks.find(t => t.id === linkSourceId
            || (t.timeRanges || []).some(r => r.id === linkSourceId)
            || (t.milestones || []).some(m => m.id === linkSourceId));
        toast.success(`연결했습니다: ${owner?.name ?? '선행'} → ${targetName}`);
    }, [flatTasks, linkSourceId, toast]);

    // 순환은 **만들어지기 전에** 막는다. 만든 뒤에 빨간 화살표로 알리는 것보다 낫다 —
    // 순환이 있는 계획은 "무엇이 먼저인가"에 답이 없어서 고치는 것 말고 할 일이 없다.
    const blocksCycle = useCallback((targetId) => {
        if (!wouldCreateDependencyCycle(dependencySuccessors, linkSourceId, targetId)) return false;
        toast.error('순환 의존성이 되므로 연결할 수 없습니다.');
        cancelLinking();
        return true;
    }, [dependencySuccessors, linkSourceId, toast, cancelLinking]);

    // 작업/기간 클릭. 연결 모드가 아니면 그냥 선택이다.
    const handleTaskClick = useCallback((taskId, rangeId) => {
        if (!isLinkingMode) {
            onSelectTask(taskId);
            return;
        }

        // 어느 기간인지 모르는 클릭(작업명 목록, 접힌 행의 요약 띠·단계 칸)은 거절한다. 받아 주던 동안
        // 레거시 작업 단위 의존성이 저장됐다 — 화살표가 그려지지 않는데 토스트는 '연결했습니다' 라고
        // 했고, 작업 id 와 그 기간 id 가 다른 노드라 순환 판정도 빠져나갔다(2026-10-13 레드팀 2차).
        if (!rangeId) {
            toast.warn('막대(기간)나 마일스톤을 눌러 연결하세요. 접힌 행은 펼친 뒤 연결할 수 있습니다.');
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

        if (blocksCycle(rangeId || taskId)) return;

        if (targetRange) {
            onUpdateTask(taskId, {
                timeRanges: targetTask.timeRanges.map(r =>
                    r.id === rangeId ? { ...r, dependencies: [...currentDeps, linkSourceId] } : r
                ),
            });
        } else {
            onUpdateTask(taskId, { dependencies: [...currentDeps, linkSourceId] });
        }
        announce(targetTask.name);
        cancelLinking();
    }, [isLinkingMode, linkSourceId, flatTasks, onUpdateTask, onSelectTask, toast, cancelLinking, blocksCycle, announce]);

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

        if (blocksCycle(milestone.id)) return;

        onUpdateTask(parentTask.id, {
            milestones: parentTask.milestones.map(m =>
                m.id === milestone.id ? { ...m, dependencies: [...currentDeps, linkSourceId] } : m
            ),
        });
        announce(milestone.label || '마일스톤');
        cancelLinking();
    }, [isLinkingMode, linkSourceId, flatTasks, onUpdateTask, toast, cancelLinking, blocksCycle, announce]);

    // 연결 끊기는 여기 없다 — 인스펙터가 taskTree.js 의 planDependencyRemoval 을 쓴다.
    // (v3 전에는 이 훅에도 마일스톤/작업만 다루는 removeDependency 가 따로 있었다.
    //  기간 보유 의존성을 못 지우는 반쪽이었고, 마일스톤 팝오버와 함께 폐기했다.)
    return { isLinkingMode, startLinking, handleTaskClick, handleMilestoneClick };
}
