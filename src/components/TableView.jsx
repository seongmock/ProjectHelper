import TaskRow from './TaskRow';
import './TableView.css';

function TableView({
    tasks,
    selectedTaskId,
    onSelectTask,
    onUpdateTask,
    onDeleteTask,
    onAddTask,
    onReorderTasks,
    viewMode
}) {
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
                        tasks.map((task) => (
                            <TaskRow
                                key={task.id}
                                task={task}
                                level={0}
                                selectedTaskId={selectedTaskId}
                                onSelectTask={onSelectTask}
                                onUpdateTask={onUpdateTask}
                                onDeleteTask={onDeleteTask}
                                onAddTask={onAddTask}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

export default TableView;
