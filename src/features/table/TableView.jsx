import React, { useMemo } from 'react';
import { Plus } from 'lucide-react';
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
import { flattenTasks } from '../../utils/dataModel';
import './TableView.css';

// Sortable Wrapper for TaskRow
function SortableTaskRow({ task, onContextMenu, ...props }) {
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
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            onContextMenu={(e) => {
                if (onContextMenu) onContextMenu(e, task.id);
            }}
        >
            <TaskRow task={task} {...props} />
        </div>
    );
}

function TableView({
    tasks,
    selectedTaskId,
    onSelectTask,
    onUpdateTask,
    onUpdateTaskSilent,
    onToggleExpand,
    onDeleteTask,
    onAddTask,
    onReorderTasks,
    onIndentTask,
    onOutdentTask,
    onMoveTask,
    onContextMenu, // Add prop
    onOpenMilestones,
    viewMode,
    isSearching
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

    // 드래그 접기/펼치기는 시각적 임시 상태 — undo 히스토리에 남기지 않음
    const silentUpdate = onUpdateTaskSilent || onUpdateTask;

    const handleDragStart = (event) => {
        const { active } = event;
        const task = flatTasks.find(t => t.id === active.id);

        if (task && task.children && task.children.length > 0 && task.expanded) {
            setDraggedTaskExpanded(true);
            silentUpdate(task.id, { expanded: false });
        } else {
            setDraggedTaskExpanded(false);
        }
    };

    // 드래그 취소(Escape 등) 시 접힌 상태 복구
    const handleDragCancel = (event) => {
        if (draggedTaskExpanded && event.active) {
            silentUpdate(event.active.id, { expanded: true });
            setDraggedTaskExpanded(false);
        }
    };

    const handleDragEnd = (event) => {
        const { active, over, delta } = event;

        // X축 이동에 따른 계층 변경 (왼쪽: 내어쓰기, 오른쪽: 들여쓰기)
        const HORIZONTAL_THRESHOLD = 40; // 민감도 조절

        // 원래 상태 복구 (드랍 후 다시 펼치기)
        if (draggedTaskExpanded) {
            silentUpdate(active.id, { expanded: true });
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
                        // 검색 중이면 "작업이 없습니다"가 거짓말이 된다 — 작업은 있고
                        // 질의에 걸리지 않았을 뿐이다. "첫 작업 추가하기"도 같은 이유로
                        // 거짓이라 내린다(추가 자체는 툴바·Ctrl+N 으로 여전히 가능하고,
                        // 그 경로는 새 작업이 보이도록 검색을 해제한다 — App.handleAddTask).
                        <div className="empty-state">
                            {isSearching ? (
                                <p>검색 결과가 없습니다.</p>
                            ) : (
                                <>
                                    <p>작업이 없습니다.</p>
                                    <button className="primary" onClick={() => onAddTask()}>
                                        <Plus size={15} aria-hidden="true" /> 첫 작업 추가하기
                                    </button>
                                </>
                            )}
                        </div>
                    ) : (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            onDragCancel={handleDragCancel}
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
                                        onToggleExpand={onToggleExpand}
                                        onDeleteTask={onDeleteTask}
                                        onAddTask={onAddTask}
                                        onIndentTask={onIndentTask}
                                        onOutdentTask={onOutdentTask}
                                        onContextMenu={onContextMenu} // Pass prop
                                        onOpenMilestones={onOpenMilestones}
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
