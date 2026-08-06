// 선택된 작업의 인스펙터 패널 (실사 §5.4-12 / P3-5).
//
// 왜 필요한가: 지금까지 작업 편집은 전부 **우클릭 팝오버**였다. 팝오버는 (1) 존재를 알아야
// 열 수 있고 (2) 화면이 좁아지면 잘리고 (3) 선택과 무관하게 떠서 "지금 무엇을 보고 있는지"를
// 알려 주지 못한다. 인스펙터는 선택을 그대로 따라가는 상시 표면이다.
//
// 팝오버를 아직 제거하지는 않았다 — 기간별 라벨/색, 의존성 연결 시작 같은 기능이 거기 남아
// 있다. 이 패널은 "선택된 작업의 요약 + 자주 쓰는 편집"까지가 범위다(HANDOVER §4 참조).
//
// 파생 정보(상태·일수·롤업·앞뒤 의존성)는 여기서 계산하지 않는다 —
// utils/taskTree.js 의 summarizeTask() 하나가 전부 계산하고 여기서는 그리기만 한다.
import { useEffect, useRef, useState } from 'react';
import { PanelRightClose, Flag, CornerDownRight, CornerUpRight, Layers } from 'lucide-react';
import { summarizeTask } from '../../utils/taskTree';
import { STATUS_STYLES } from '../../themes/index.js';
import { formatDate } from '../../utils/dataModel';
import ColorPicker from '../../shared/ui/ColorPicker';
import './InspectorPanel.css';

const statusLabel = (status) => STATUS_STYLES.find(s => s.id === status)?.label || '일정 없음';
const statusColor = (status) => STATUS_STYLES.find(s => s.id === status)?.color || 'var(--color-text-secondary)';

// 남은 일수를 사람 말로. 0 은 "오늘"이고, 음수는 지난 일수다.
const remainingText = (days) => {
    if (days === null) return null;
    if (days === 0) return '오늘 종료';
    return days > 0 ? `${days}일 남음` : `${-days}일 지남`;
};

// 텍스트 편집은 **blur/Enter 에 커밋**한다. 글자마다 커밋하면 undo 히스토리(최대 20칸)가
// 타이핑만으로 가득 차서 직전 작업을 되돌릴 수 없게 된다. 표(TaskRow)의 이름 편집도 같은
// 방식이다. Escape 는 편집을 버린다.
function DraftField({ tag: Tag = 'input', value, onCommit, ...rest }) {
    const [draft, setDraft] = useState(value);
    const isEditing = useRef(false);

    // 바깥(다른 편집 표면·undo·AI 쓰기)에서 값이 바뀌면 따라간다. 편집 중에는 덮지 않는다.
    useEffect(() => {
        if (!isEditing.current) setDraft(value);
    }, [value]);

    const commit = () => {
        isEditing.current = false;
        if (draft !== value) onCommit(draft);
    };

    return (
        <Tag
            {...rest}
            value={draft}
            onChange={(e) => { isEditing.current = true; setDraft(e.target.value); }}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && Tag === 'input') e.currentTarget.blur();
                if (e.key === 'Escape') {
                    isEditing.current = false;
                    setDraft(value);
                    e.currentTarget.blur();
                }
            }}
        />
    );
}

function InspectorPanel({ tasks, selectedTaskId, onUpdateTask, onSelectTask, onClose }) {
    const todayStr = formatDate(new Date());
    const summary = summarizeTask(tasks, selectedTaskId, todayStr);

    return (
        <aside className="inspector-panel" aria-label="인스펙터">
            <div className="inspector-header">
                <span className="inspector-title">인스펙터</span>
                <button className="inspector-close" onClick={onClose} title="인스펙터 닫기" aria-label="인스펙터 닫기">
                    <PanelRightClose size={15} aria-hidden="true" />
                </button>
            </div>

            {!summary ? (
                <div className="inspector-empty">
                    작업을 선택하면 여기에 상세가 표시된다.
                    <span className="inspector-hint">↑↓ 로도 선택할 수 있다.</span>
                </div>
            ) : (
                <div className="inspector-body">
                    <section className="inspector-section">
                        <DraftField
                            key={`name-${summary.task.id}`}
                            className="inspector-name"
                            data-testid="inspector-name"
                            value={summary.task.name}
                            onCommit={(name) => onUpdateTask(summary.task.id, { name })}
                            aria-label="작업 이름"
                        />
                        {summary.parentName && (
                            <div className="inspector-parent" title={summary.parentName}>
                                <CornerUpRight size={12} aria-hidden="true" /> {summary.parentName}
                            </div>
                        )}
                        <span
                            className="inspector-status"
                            data-testid="inspector-status"
                            style={{ '--status-color': statusColor(summary.status) }}
                        >
                            {statusLabel(summary.status)}
                        </span>
                    </section>

                    <section className="inspector-section">
                        <dl className="inspector-facts">
                            <dt>기간</dt>
                            <dd data-testid="inspector-dates">
                                {summary.startDate ? `${summary.startDate} ~ ${summary.endDate}` : '—'}
                            </dd>
                            <dt>소요</dt>
                            <dd>{summary.durationDays !== null ? `${summary.durationDays}일` : '—'}</dd>
                            <dt>남은 기간</dt>
                            <dd className={summary.daysToEnd !== null && summary.daysToEnd < 0 ? 'is-late' : ''}>
                                {remainingText(summary.daysToEnd) || '—'}
                            </dd>
                            <dt>구성</dt>
                            <dd>
                                기간 {summary.ranges.length} · 마일스톤 {summary.milestones.length} · 하위 {summary.descendantCount}
                            </dd>
                        </dl>
                    </section>

                    <section className="inspector-section">
                        <div className="inspector-label">진행률 — {summary.task.progress ?? 0}%</div>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            step="5"
                            data-testid="inspector-progress"
                            value={summary.task.progress ?? 0}
                            onChange={(e) => onUpdateTask(summary.task.id, { progress: Number(e.target.value) })}
                        />
                        {summary.rollupProgress !== null && (
                            <div className="inspector-rollup">
                                <Layers size={12} aria-hidden="true" />
                                하위 {summary.descendantCount}개 평균 {summary.rollupProgress}%
                            </div>
                        )}
                    </section>

                    <section className="inspector-section">
                        <div className="inspector-label">색상</div>
                        <ColorPicker
                            color={summary.task.color}
                            onChange={(color) => onUpdateTask(summary.task.id, { color })}
                        />
                    </section>

                    <section className="inspector-section">
                        <div className="inspector-label">설명</div>
                        <DraftField
                            key={`desc-${summary.task.id}`}
                            tag="textarea"
                            className="inspector-description"
                            data-testid="inspector-description"
                            placeholder="작업 설명"
                            value={summary.task.description || ''}
                            onCommit={(description) => onUpdateTask(summary.task.id, { description })}
                        />
                    </section>

                    {summary.milestones.length > 0 && (
                        <section className="inspector-section">
                            <div className="inspector-label">마일스톤</div>
                            <ul className="inspector-list">
                                {summary.milestones.map(m => (
                                    <li key={m.id}>
                                        <Flag size={12} aria-hidden="true" style={{ color: m.color }} />
                                        <span className="inspector-list-name">{m.label || '(이름 없음)'}</span>
                                        <span className="inspector-list-meta">{m.date}</span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {(summary.predecessors.length > 0 || summary.successors.length > 0) && (
                        <section className="inspector-section">
                            <div className="inspector-label">의존성</div>
                            {summary.predecessors.length > 0 && (
                                <ul className="inspector-list">
                                    {summary.predecessors.map(e => (
                                        <li key={e.id}>
                                            <CornerUpRight size={12} aria-hidden="true" />
                                            <button
                                                className="inspector-link"
                                                // 기간·마일스톤은 그 자체를 선택할 수 없으므로 소유 작업으로 보낸다
                                                onClick={() => onSelectTask(e.parentId || e.id)}
                                            >
                                                {e.name}
                                            </button>
                                            <span className="inspector-list-meta">선행</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {summary.successors.length > 0 && (
                                <ul className="inspector-list">
                                    {summary.successors.map(e => (
                                        <li key={e.id}>
                                            <CornerDownRight size={12} aria-hidden="true" />
                                            <button
                                                className="inspector-link"
                                                onClick={() => onSelectTask(e.parentId || e.id)}
                                            >
                                                {e.name}
                                            </button>
                                            <span className="inspector-list-meta">후행</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    )}
                </div>
            )}
        </aside>
    );
}

export default InspectorPanel;
