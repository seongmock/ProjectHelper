import React, { useMemo } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    defaultDropAnimationSideEffects,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import TaskRow from './TaskRow';
import { flattenTasks } from '../utils/dataModel';
import './TableView.css';

// Sortable Wrapper for TaskRow
function SortableTaskRow({ task, ...props }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: task.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 1, // 드래그 중인 항목 위로
        position: 'relative',
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <TaskRow task={task} {...props} />
        </div>
    );
}

function TableView({
    tasks,
    selectedTaskId,
    onSelectTask,
    onUpdateTask,
    onDeleteTask,
    onAddTask,
    onReorderTasks,
    onIndentTask,
    onOutdentTask,
    onMoveTask,
    viewMode
}) {
    // 트리 구조를 평탄화하여 DnD에 사용
    const flatTasks = useMemo(() => flattenTasks(tasks), [tasks]);
    const items = useMemo(() => flatTasks.map(t => t.id), [flatTasks]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8, // 8px 이동해야 드래그 시작 (클릭과 구분)
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    // 드래그 시작 시 확장된 작업 접기 (시각적 그룹화)
    const [draggedTaskExpanded, setDraggedTaskExpanded] = React.useState(false);

    const handleDragStart = (event) => {
        const { active } = event;
        const task = flatTasks.find(t => t.id === active.id);

        if (task && task.children && task.children.length > 0 && task.expanded) {
            setDraggedTaskExpanded(true);
            onUpdateTask(task.id, { expanded: false });
        } else {
            setDraggedTaskExpanded(false);
        }
    };

    const handleDragEnd = (event) => {
        const { active, over, delta } = event;

        // X축 이동에 따른 계층 변경 (왼쪽: 내어쓰기, 오른쪽: 들여쓰기)
        const HORIZONTAL_THRESHOLD = 40; // 민감도 조절

        // 원래 상태 복구 (드랍 후 다시 펼치기)
        if (draggedTaskExpanded) {
            onUpdateTask(active.id, { expanded: true });
            setDraggedTaskExpanded(false);
        }

        if (delta.x > HORIZONTAL_THRESHOLD) {
            onIndentTask(active.id);
            return;
        } else if (delta.x < -HORIZONTAL_THRESHOLD) {
            onOutdentTask(active.id);
            return;
        }

        // 수직 이동 (순서 변경)
        if (over && active.id !== over.id) {
            onMoveTask(active.id, over.id);
        }
    };

    return (
        <div className={`table-view ${viewMode === 'split' ? 'split-mode' : ''}`}>
            <div className="table-container">
                {/* 테이블 헤더 */}
                <div className="table-header">
                    <div className="col-name">작업명</div>
                    <div className="col-dates">시작일</div>
                    <div className="col-dates">종료일</div>
                    <div className="col-milestones">마일스톤</div>
                    <div className="col-color">색상</div>
                    <div className="col-actions">작업</div>
                </div>

                {/* 테이블 본문 */}
                <div className="table-body">
                    {tasks.length === 0 ? (
                        <div className="empty-state">
                            <p>작업이 없습니다.</p>
                            <button className="primary" onClick={() => onAddTask()}>
                                ➕ 첫 작업 추가하기
                            </button>
                        </div>
                    ) : (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                        >
                            <SortableContext
                                items={items}
                                strategy={verticalListSortingStrategy}
                            >
                                {flatTasks.map((task) => (
                                    <SortableTaskRow
                                        key={task.id}
                                        task={task}
                                        level={task.level}
                                        selectedTaskId={selectedTaskId}
                                        onSelectTask={onSelectTask}
                                        onUpdateTask={onUpdateTask}
                                        onDeleteTask={onDeleteTask}
                                        onAddTask={onAddTask}
                                        onIndentTask={onIndentTask}
                                        onOutdentTask={onOutdentTask}
                                        renderChildren={false} // 평탄화된 리스트이므로 자식 렌더링 방지
                                    />
                                ))}
                            </SortableContext>
                        </DndContext>
                    )}
                </div>
            </div>
        </div>
    );
}

export default TableView;
