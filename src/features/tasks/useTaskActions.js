// 작업 트리 조작 핸들러 모음.
//
// 전부 taskTree.js 의 순수함수를 감싸는 얇은 래퍼다 — 로직은 여기 두지 않는다.
// undo 히스토리에 남길 것은 setTasks, 남기지 않을 것(드래그 중 임시 상태)은 setTasksSilent.
import { useCallback, useMemo } from 'react';
import { createNewTask, generateId } from '../../utils/dataModel';
import {
    updateTaskInTree,
    deleteFromTree,
    addToParent,
    indentTask,
    outdentTask,
    moveTaskInTree,
    findTaskAndParent,
} from '../../utils/taskTree';

export function useTaskActions({ setTasks, setTasksSilent, onSelect }) {
    const addTask = useCallback((parentId = null) => {
        const newTask = createNewTask('새 작업', parentId);
        setTasks(prev => (parentId ? addToParent(prev, parentId, newTask) : [...prev, newTask]));
        onSelect(newTask.id);
    }, [setTasks, onSelect]);

    const updateTask = useCallback((taskId, updates) => {
        setTasks(prev => updateTaskInTree(prev, taskId, updates));
    }, [setTasks]);

    // 히스토리에 남기지 않는 갱신 (드래그 중 접기/펼치기 등 시각적 임시 상태)
    const updateTaskSilent = useCallback((taskId, updates) => {
        setTasksSilent(prev => updateTaskInTree(prev, taskId, updates));
    }, [setTasksSilent]);

    // 여러 작업을 한 번의 상태 변경으로 — undo 한 번에 되돌아가야 한다
    const updateTasks = useCallback((updatesArray) => {
        setTasks(prev => updatesArray.reduce(
            (acc, { taskId, updates }) => updateTaskInTree(acc, taskId, updates),
            prev
        ));
    }, [setTasks]);

    const deleteTask = useCallback((taskId) => {
        setTasks(prev => deleteFromTree(prev, taskId));
        onSelect(null);
    }, [setTasks, onSelect]);

    const indent = useCallback((taskId) => {
        setTasks(prev => indentTask(prev, taskId));
    }, [setTasks]);

    const outdent = useCallback((taskId) => {
        setTasks(prev => outdentTask(prev, taskId));
    }, [setTasks]);

    const moveTask = useCallback((activeId, overId) => {
        setTasks(prev => moveTaskInTree(prev, activeId, overId));
    }, [setTasks]);

    const reorderTasks = useCallback((reordered) => setTasks(reordered), [setTasks]);

    // 접힌 부모 아래의 작업에도 동작해야 하므로 flattenTasks(보이는 것만)가 아니라
    // 트리 전체를 탐색한다.
    const addMilestone = useCallback((taskId, milestoneData) => {
        setTasks(prev => {
            const found = findTaskAndParent(prev, taskId);
            if (!found) return prev;
            const milestones = [...(found.task.milestones || []), { id: generateId(), ...milestoneData }];
            return updateTaskInTree(prev, taskId, { milestones });
        });
    }, [setTasks]);

    // 객체 자체도 안정적이어야 한다 — 이 객체를 의존성으로 쓰는 effect 가 있다
    return useMemo(() => ({
        addTask,
        updateTask,
        updateTaskSilent,
        updateTasks,
        deleteTask,
        indent,
        outdent,
        moveTask,
        reorderTasks,
        addMilestone,
    }), [addTask, updateTask, updateTaskSilent, updateTasks, deleteTask,
        indent, outdent, moveTask, reorderTasks, addMilestone]);
}
