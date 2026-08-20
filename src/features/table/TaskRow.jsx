import { useState } from 'react';
import {
    IndentDecrease, IndentIncrease, Plus, Trash2, Flag, TriangleAlert,
    CornerUpRight, CornerDownRight, Unlink,
} from 'lucide-react';
import { generateId, formatDate } from '../../utils/dataModel';
import { recalcTaskBoundsSafe, isTaskOverdue, milestonesInDateOrder, patchRange } from '../../utils/taskTree';
import { describeRowDependencies } from './dependencyBadges';
import { milestoneShape } from '../../shared/milestoneShapes';
import ColorPicker from '../../shared/ui/ColorPicker';
import './TaskRow.css';

function TaskRow({
    task,
    level = 0,
    selectedTaskId,
    onSelectTask,
    onUpdateTask,
    onToggleExpand,
    onDeleteTask,
    onAddTask,
    onIndentTask,
    onOutdentTask,
    onOpenMilestones,
    dependencyRows = null,
    onOpenDependencies,
    renderChildren = true
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedName, setEditedName] = useState(task.name);
    const [showColorPicker, setShowColorPicker] = useState(false);

    const isSelected = task.id === selectedTaskId;
    const hasChildren = task.children && task.children.length > 0;

    // 날짜의 원본은 timeRanges — 표에서는 시간순 첫 번째 기간을 편집한다
    const firstRange = (task.timeRanges && task.timeRanges.length > 0)
        ? [...task.timeRanges].sort((a, b) => new Date(a.startDate) - new Date(b.startDate))[0]
        : null;
    const extraRangeCount = (task.timeRanges?.length || 0) - 1;
    const overdue = isTaskOverdue(task, formatDate(new Date()));
    // 이 행이 대표하는 연결. 접힌 가지의 것까지 끌어올려 담겨 있다(summarizeRowDependencies).
    const dependencies = dependencyRows?.get(task.id) || null;

    // 펼치기/접기 — 어디에 쓸지는 App 의 관문이 정한다(검색 중이면 화면 상태, 아니면 트리).
    // 여기서 트리에 직접 쓰면 검색 중에는 화면에 반영되지 않는 값을 문서에 남기게 된다.
    const handleToggleExpand = (e) => {
        e.stopPropagation();
        onToggleExpand(task.id, !task.expanded);
    };

    // 작업명 편집
    const handleNameDoubleClick = () => {
        setIsEditing(true);
        setEditedName(task.name);
    };

    const handleNameChange = (e) => {
        setEditedName(e.target.value);
    };

    const handleNameBlur = () => {
        if (editedName.trim()) {
            onUpdateTask(task.id, { name: editedName.trim() });
        }
        setIsEditing(false);
    };

    const handleNameKeyDown = (e) => {
        // DnD 라이브러리가 스페이스바 등을 가로채지 않도록 이벤트 전파 중단
        e.stopPropagation();

        if (e.key === 'Enter') {
            handleNameBlur();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditedName(task.name);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            if (e.shiftKey) {
                onOutdentTask(task.id);
            } else {
                onIndentTask(task.id);
            }
        }
    };

    // 날짜 변경 — 첫 timeRange를 수정하고 전체 시작/종료 캐시 재계산 (타임라인과 동기화).
    // 인스펙터와 **같은 순수함수**(patchRange)를 거친다: bounds 재계산도, 역전 입력을
    // 경계로 되돌리는 것도 거기 한 곳에 있다. 여기서 인라인으로 map 하던 시절에는
    // 종료 < 시작을 그대로 통과시켜 타임라인에서 바가 사라졌다.
    const handleDateChange = (field, value) => {
        if (!value) return; // 입력이 비워진 경우 무시
        if (!firstRange) {
            // 기간이 없는 작업: 선택한 날짜로 1일짜리 기간 생성
            const ranges = [{ id: generateId(), startDate: value, endDate: value, dependencies: [], color: null, label: '' }];
            onUpdateTask(task.id, { timeRanges: ranges, ...recalcTaskBoundsSafe(ranges) });
            return;
        }
        onUpdateTask(task.id, patchRange(task, firstRange.id, { [field]: value }));
    };

    // 색상 변경
    const handleColorChange = (color) => {
        onUpdateTask(task.id, { color });
        setShowColorPicker(false);
    };

    // 삭제
    const handleDelete = () => {
        if (confirm(`"${task.name}" 작업을 삭제하시겠습니까?`)) {
            onDeleteTask(task.id);
        }
    };

    // 하위 작업 추가
    const handleAddChild = () => {
        onAddTask(task.id);
    };

    // 마일스톤 편집은 인스펙터가 유일한 표면이다(v4). 여기서는 지목만 한다 —
    // 미리보기를 누르면 그 작업을 선택하고 인스펙터를 열어 첫 마일스톤을 포커스한다.
    const orderedMilestones = milestonesInDateOrder(task);

    const handleOpenMilestones = () => {
        onOpenMilestones(task.id, orderedMilestones[0]?.id || null);
    };

    // 마일스톤 모양 미리보기. 어떤 모양인지는 shared/milestoneShapes.js 가 정한다 —
    // 예전에는 표가 직접(삼각형은 CSS border, 별·깃발은 텍스트 글리프) 그려서 같은
    // 데이터가 차트와 다른 그림으로 보였다. 표현만 여기서 정한다: 12px 미리보기에
    // 차트의 흰 테두리(2px)와 그림자를 얹으면 도형이 잡아먹히므로 색만 채운다.
    const renderMilestoneShape = (shape, color, size = 16) => {
        const spec = milestoneShape(shape);
        if (spec.kind === 'box') {
            return (
                <span style={{
                    width: `${size}px`,
                    height: `${size}px`,
                    backgroundColor: color,
                    display: 'inline-block',
                    marginRight: spec.rotate ? '8px' : '4px',
                    ...(spec.borderRadius ? { borderRadius: spec.borderRadius } : {}),
                    ...(spec.rotate ? { transform: `rotate(${spec.rotate}deg)` } : {}),
                }} />
            );
        }
        return (
            <svg width={size} height={size} viewBox={spec.viewBox}
                style={{ display: 'inline-block', marginRight: '4px', verticalAlign: 'middle' }}>
                <path d={spec.path} fill={color} />
            </svg>
        );
    };

    return (
        <>
            <div
                className={`task-row ${isSelected ? 'selected' : ''} level-${level}`}
                onClick={() => onSelectTask(task.id)}
            >
                {/* 작업명 */}
                <div className="col-name" style={{ paddingLeft: `${level * 24 + 12}px` }}>
                    {hasChildren && (
                        <button
                            className="expand-toggle icon"
                            onClick={handleToggleExpand}
                        >
                            {task.expanded ? '▼' : '▶'}
                        </button>
                    )}
                    {!hasChildren && <span className="expand-spacer"></span>}

                    {isEditing ? (
                        <input
                            type="text"
                            value={editedName}
                            onChange={handleNameChange}
                            onBlur={handleNameBlur}
                            onKeyDown={handleNameKeyDown}
                            autoFocus
                            className="name-input"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onKeyUp={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <span
                            className="task-name"
                            onDoubleClick={handleNameDoubleClick}
                            // 컬럼 폭이 고정이라 긴 작업명은 잘린다. 전체 이름을 툴팁으로 노출한다.
                            title={`${task.name}\n(더블클릭하여 편집)`}
                        >
                            {task.name}
                        </span>
                    )}
                    {overdue && (
                        // 지연을 색으로만 표시하면 색약 사용자가 판별할 수 없다 — 아이콘을 함께 쓴다
                        <span className="overdue-flag" title="지연: 종료일이 지났으나 완료되지 않았습니다" aria-label="지연">
                            <TriangleAlert size={13} aria-hidden="true" />
                        </span>
                    )}
                    {(task.progress ?? 0) > 0 && (
                        <span className="progress-badge" title={`진행률 ${task.progress}%`}>{task.progress}%</span>
                    )}
                </div>

                {/* 시작일 (첫 번째 기간 기준). max/min 은 달력이 역전된 날짜를 아예 못
                    고르게 한다 — 손으로 입력한 경우는 patchRange 가 경계로 되돌린다 */}
                <div className="col-dates">
                    <input
                        type="date"
                        value={firstRange?.startDate || ''}
                        max={firstRange?.endDate || undefined}
                        onChange={(e) => handleDateChange('startDate', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>

                {/* 종료일 (첫 번째 기간 기준) — 지연 시 경고색 */}
                <div className={`col-dates ${overdue ? 'overdue' : ''}`}>
                    <input
                        type="date"
                        value={firstRange?.endDate || ''}
                        min={firstRange?.startDate || undefined}
                        onChange={(e) => handleDateChange('endDate', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                    />
                    {extraRangeCount > 0 && (
                        <span
                            className="range-count-badge"
                            title={`기간 ${extraRangeCount + 1}개 — 나머지는 타임라인에서 편집`}
                        >
                            +{extraRangeCount}
                        </span>
                    )}
                </div>

                {/* 마일스톤 */}
                <div className="col-milestones">
                    <button
                        className="milestone-button"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleOpenMilestones();
                        }}
                        title="마일스톤 — 인스펙터에서 편집"
                    >
                        {orderedMilestones.length > 0 ? (
                            <div className="milestone-preview">
                                {orderedMilestones.slice(0, 3).map((m) => (
                                    <span key={m.id} className="milestone-shape-preview">
                                        {renderMilestoneShape(m.shape, m.color, 12)}
                                    </span>
                                ))}
                                {orderedMilestones.length > 3 && <span className="milestone-more">+{orderedMilestones.length - 3}</span>}
                            </div>
                        ) : (
                            <><Flag size={13} aria-hidden="true" /> 0</>
                        )}
                    </button>
                </div>

                {/* 의존성 — 표에는 연결 표현이 아예 없었다. 여기서는 존재와 방향만 말하고
                    편집은 인스펙터 하나다(마일스톤 칼럼과 같은 규약). 연결이 없으면 버튼이
                    아니라 "—" 다: 표 뷰에서는 연결 추가가 잠겨 있어 열어도 할 것이 없다 */}
                <div className="col-deps">
                    {dependencies ? (
                        <button
                            className={`dependency-button ${dependencies.issue ? `has-${dependencies.issue}` : ''}`}
                            data-testid="row-dependencies"
                            onClick={(e) => {
                                e.stopPropagation();
                                onOpenDependencies(task.id);
                            }}
                            title={describeRowDependencies(dependencies)}
                        >
                            {dependencies.predecessors.length > 0 && (
                                <span className="dependency-count" aria-label={`선행 ${dependencies.predecessors.length}`}>
                                    <CornerUpRight size={12} aria-hidden="true" />{dependencies.predecessors.length}
                                </span>
                            )}
                            {dependencies.successors.length > 0 && (
                                <span className="dependency-count" aria-label={`후행 ${dependencies.successors.length}`}>
                                    <CornerDownRight size={12} aria-hidden="true" />{dependencies.successors.length}
                                </span>
                            )}
                            {/* 문제는 색만으로 말하지 않는다 — 아이콘을 함께 쓴다(§5.3) */}
                            {dependencies.issue === 'broken' ? (
                                <Unlink size={12} aria-label="끊어진 참조" />
                            ) : dependencies.issue ? (
                                <TriangleAlert size={12} aria-label={dependencies.issue === 'cycle' ? '순환 의존성' : '일정 위반'} />
                            ) : null}
                        </button>
                    ) : (
                        <span className="dependency-none" aria-label="연결 없음">—</span>
                    )}
                </div>

                {/* 색상 */}
                <div className="col-color">
                    <div className="color-picker-wrapper">
                        <button
                            className="color-button"
                            style={{ backgroundColor: task.color }}
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowColorPicker(!showColorPicker);
                            }}
                            title="색상 선택"
                        />
                        {showColorPicker && (
                            <ColorPicker
                                color={task.color}
                                onChange={handleColorChange}
                            />
                        )}
                    </div>
                </div>

                {/* 작업 버튼 */}
                <div className="col-actions">
                    <button
                        className="icon"
                        onClick={(e) => {
                            e.stopPropagation();
                            onOutdentTask(task.id);
                        }}
                        title="내어쓰기 (Shift+Tab)"
                    >
                        <IndentDecrease size={15} aria-hidden="true" />
                    </button>
                    <button
                        className="icon"
                        onClick={(e) => {
                            e.stopPropagation();
                            onIndentTask(task.id);
                        }}
                        title="들여쓰기 (Tab)"
                    >
                        <IndentIncrease size={15} aria-hidden="true" />
                    </button>
                    <button
                        className="icon"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleAddChild();
                        }}
                        title="하위 작업 추가"
                    >
                        <Plus size={15} aria-hidden="true" />
                    </button>
                    <button
                        className="icon danger"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDelete();
                        }}
                        title="삭제 (Delete)"
                    >
                        <Trash2 size={15} aria-hidden="true" />
                    </button>
                </div>
            </div>

            {/* 하위 작업들 */}
            {renderChildren && hasChildren && task.expanded && (
                <>
                    {task.children.map((child) => (
                        <TaskRow
                            key={child.id}
                            task={child}
                            level={level + 1}
                            selectedTaskId={selectedTaskId}
                            onSelectTask={onSelectTask}
                            onUpdateTask={onUpdateTask}
                            onDeleteTask={onDeleteTask}
                            onAddTask={onAddTask}
                            onIndentTask={onIndentTask}
                            onOutdentTask={onOutdentTask}
                            onOpenMilestones={onOpenMilestones}
                            dependencyRows={dependencyRows}
                            onOpenDependencies={onOpenDependencies}
                        />
                    ))}
                </>
            )}
        </>
    );
}

export default TaskRow;
