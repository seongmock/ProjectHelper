// 선택된 작업의 인스펙터 패널 (실사 §5.4-12 / P3-5).
//
// 왜 필요한가: 원래 작업 편집은 전부 **우클릭 팝오버**였다. 팝오버는 (1) 존재를 알아야
// 열 수 있고 (2) 화면이 좁아지면 잘리고 (3) 선택과 무관하게 떠서 "지금 무엇을 보고 있는지"를
// 알려 주지 못한다. 인스펙터는 선택을 그대로 따라가는 상시 표면이다.
//
// v2(2026-08-07): `TimelineBarPopover`(작업/기간 설정 팝오버)를 이 패널이 전부 흡수하고
// 그 파일을 폐기했다. 우클릭은 이제 "선택 + 인스펙터 열기 + 그 기간을 포커스"로 바뀐다.
// 마일스톤 편집 팝오버(`MilestoneEditPopover`)는 아직 남아 있다 — 그 흡수가 v3.
//
// 파생 정보(상태·일수·롤업·앞뒤 의존성)는 여기서 계산하지 않는다 —
// utils/taskTree.js 의 summarizeTask() 하나가 전부 계산하고 여기서는 그리기만 한다.
// 기간 수정도 같은 원칙으로 patchRange/appendRange/removeRange 를 거친다(bounds 재계산 포함).
import { useEffect, useRef, useState } from 'react';
import {
    PanelRightClose, Flag, CornerDownRight, CornerUpRight, Layers,
    Plus, Trash2, X, Link2,
} from 'lucide-react';
import { summarizeTask, patchRange, appendRange, removeRange } from '../../utils/taskTree';
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

const LABEL_POSITIONS = [
    { value: 'above', label: '위' },
    { value: 'below', label: '아래' },
    { value: 'inside', label: '내부' },
];

const BAR_HEIGHTS = [
    { value: null, label: '기본' },
    { value: 16, label: 'S' },
    { value: 20, label: 'M' },
    { value: 24, label: 'L' },
    { value: 28, label: 'XL' },
];

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

// 라디오 성격의 작은 버튼 묶음. 기간 레이블 위치와 바 높이가 같은 모양이라 한 벌만 둔다.
function Segmented({ label, value, options, onChange }) {
    return (
        <div className="inspector-segmented">
            <span className="inspector-segmented-label">{label}</span>
            {options.map(opt => (
                <button
                    key={String(opt.value)}
                    type="button"
                    className={value === opt.value ? 'is-active' : ''}
                    aria-pressed={value === opt.value}
                    onClick={() => onChange(opt.value)}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

// 기간 한 건. 라벨과 날짜만 펼쳐 두고 색·표시 옵션은 <details> 로 접는다 —
// 색 팔레트만 한 줄(9칸)이라 전부 펼치면 기간 3개로 300px 패널을 넘긴다.
function RangeRow({ range, task, isFocused, onPatch, onRemove }) {
    return (
        <div className={`inspector-range ${isFocused ? 'is-focused' : ''}`} data-testid="inspector-range">
            <div className="inspector-range-top">
                <DraftField
                    key={`label-${range.id}`}
                    className="inspector-range-label"
                    value={range.label || ''}
                    placeholder="기간 라벨"
                    aria-label="기간 라벨"
                    onCommit={(label) => onPatch({ label })}
                />
                <button
                    type="button"
                    className="inspector-icon-btn is-danger"
                    title="기간 삭제"
                    aria-label="기간 삭제"
                    onClick={() => {
                        if (window.confirm('이 기간을 삭제하시겠습니까?')) onRemove();
                    }}
                >
                    <X size={13} aria-hidden="true" />
                </button>
            </div>

            <div className="inspector-range-dates">
                <input
                    type="date"
                    value={range.startDate || ''}
                    aria-label="시작일"
                    data-testid="inspector-range-start"
                    onChange={(e) => onPatch({ startDate: e.target.value })}
                />
                <span aria-hidden="true">~</span>
                <input
                    type="date"
                    value={range.endDate || ''}
                    aria-label="종료일"
                    data-testid="inspector-range-end"
                    onChange={(e) => onPatch({ endDate: e.target.value })}
                />
            </div>

            <details className="inspector-range-more">
                <summary>색상 · 표시 옵션</summary>
                <ColorPicker
                    color={range.color || task.color}
                    onChange={(color) => onPatch({ color })}
                />
                <label className="inspector-check">
                    <input
                        type="checkbox"
                        checked={range.showDurationLabel !== false}
                        onChange={(e) => onPatch({ showDurationLabel: e.target.checked })}
                    />
                    기간 레이블 표시
                </label>
                {range.showDurationLabel !== false && (
                    <Segmented
                        label="위치"
                        value={range.durationLabelPosition || 'above'}
                        options={LABEL_POSITIONS}
                        onChange={(durationLabelPosition) => onPatch({ durationLabelPosition })}
                    />
                )}
                <Segmented
                    label="바 높이"
                    value={range.barHeight ?? null}
                    options={BAR_HEIGHTS}
                    onChange={(barHeight) => onPatch({ barHeight })}
                />
            </details>
        </div>
    );
}

function DividerSection({ task, onUpdateTask }) {
    const divider = task.divider || {};
    const patch = (updates) => onUpdateTask(task.id, { divider: { ...divider, ...updates } });

    return (
        <section className="inspector-section">
            <label className="inspector-check">
                <input
                    type="checkbox"
                    checked={!!divider.enabled}
                    onChange={(e) => patch({
                        enabled: e.target.checked,
                        style: divider.style || 'solid',
                        color: divider.color || '#000000',
                        thickness: divider.thickness || 2,
                    })}
                />
                구분선
            </label>

            {divider.enabled && (
                <div className="inspector-divider-settings">
                    <label>
                        <span>스타일</span>
                        <select value={divider.style || 'solid'} onChange={(e) => patch({ style: e.target.value })}>
                            <option value="solid">────── (Solid)</option>
                            <option value="dashed">- - - - - (Dashed)</option>
                            <option value="dotted">·········· (Dotted)</option>
                        </select>
                    </label>
                    {/* 색 팔레트는 한 줄을 다 쓴다 — 라벨과 같은 줄에 두면 라벨이 줄바꿈된다 */}
                    <label className="is-stacked">
                        <span>색상</span>
                        <ColorPicker color={divider.color || '#000000'} onChange={(color) => patch({ color })} />
                    </label>
                    <label>
                        <span>두께</span>
                        <input
                            type="number"
                            min="1"
                            max="10"
                            value={divider.thickness || 2}
                            onChange={(e) => patch({ thickness: parseInt(e.target.value, 10) || 1 })}
                        />
                    </label>
                </div>
            )}
        </section>
    );
}

function InspectorPanel({
    tasks,
    selectedTaskId,
    selectedRangeId,
    onUpdateTask,
    onSelectTask,
    onDeleteTask,
    onRemoveDependency,
    onAddMilestone,
    onStartLinking,
    canLink,
    onClose,
}) {
    const todayStr = formatDate(new Date());
    const summary = summarizeTask(tasks, selectedTaskId, todayStr);
    const task = summary?.task;

    // 기간 patch/삭제는 순수함수가 bounds 까지 계산한다. null = 대상이 없어 바뀔 것이 없음.
    const applyRangePatch = (rangeId, patch) => {
        const updates = patchRange(task, rangeId, patch);
        if (updates) onUpdateTask(task.id, updates);
    };
    const dropRange = (rangeId) => {
        const updates = removeRange(task, rangeId);
        if (updates) onUpdateTask(task.id, updates);
    };

    // 선택된 기간(우클릭으로 들어온 것)이 지금 작업 소유가 아니면 무시한다 —
    // 다른 작업을 선택한 뒤에도 남아 있으면 엉뚱한 기간이 강조된다.
    const focusedRangeId = summary?.ranges.some(r => r.id === selectedRangeId) ? selectedRangeId : null;

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
                            key={`name-${task.id}`}
                            className="inspector-name"
                            data-testid="inspector-name"
                            value={task.name}
                            onCommit={(name) => onUpdateTask(task.id, { name })}
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
                        <div className="inspector-label">진행률 — {task.progress ?? 0}%</div>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            step="5"
                            data-testid="inspector-progress"
                            value={task.progress ?? 0}
                            onChange={(e) => onUpdateTask(task.id, { progress: Number(e.target.value) })}
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
                            color={task.color}
                            onChange={(color) => onUpdateTask(task.id, { color })}
                        />
                    </section>

                    <section className="inspector-section">
                        <div className="inspector-label">설명</div>
                        <DraftField
                            key={`desc-${task.id}`}
                            tag="textarea"
                            className="inspector-description"
                            data-testid="inspector-description"
                            placeholder="작업 설명"
                            value={task.description || ''}
                            onCommit={(description) => onUpdateTask(task.id, { description })}
                        />
                    </section>

                    <section className="inspector-section">
                        <div className="inspector-label">기간</div>
                        {summary.ranges.map(range => (
                            <RangeRow
                                key={range.id}
                                range={range}
                                task={task}
                                isFocused={range.id === focusedRangeId}
                                onPatch={(patch) => applyRangePatch(range.id, patch)}
                                onRemove={() => dropRange(range.id)}
                            />
                        ))}
                        <button
                            type="button"
                            className="inspector-add-btn"
                            data-testid="inspector-add-range"
                            onClick={() => onUpdateTask(task.id, appendRange(task, summary.endDate || todayStr))}
                        >
                            <Plus size={13} aria-hidden="true" /> 기간 추가
                        </button>
                    </section>

                    <section className="inspector-section">
                        <div className="inspector-label">마일스톤</div>
                        {summary.milestones.length > 0 && (
                            <ul className="inspector-list">
                                {summary.milestones.map(m => (
                                    <li key={m.id}>
                                        <Flag size={12} aria-hidden="true" style={{ color: m.color }} />
                                        <span className="inspector-list-name">{m.label || '(이름 없음)'}</span>
                                        <span className="inspector-list-meta">{m.date}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <button
                            type="button"
                            className="inspector-add-btn"
                            data-testid="inspector-add-milestone"
                            onClick={() => onAddMilestone(task, summary.endDate || todayStr)}
                        >
                            <Plus size={13} aria-hidden="true" /> 마일스톤 추가
                        </button>
                    </section>

                    <section className="inspector-section">
                        <div className="inspector-label">의존성</div>
                        {summary.predecessors.length === 0 && summary.successors.length === 0 && (
                            <div className="inspector-none">연결된 작업이 없다.</div>
                        )}
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
                                        <button
                                            type="button"
                                            className="inspector-icon-btn is-danger"
                                            title="연결 제거"
                                            aria-label="연결 제거"
                                            // 선행은 **내 쪽**이 의존성을 들고 있다 → holderId 는 내 엔티티
                                            onClick={() => onRemoveDependency(e.holderId, e.id)}
                                        >
                                            <X size={12} aria-hidden="true" />
                                        </button>
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
                                        <button
                                            type="button"
                                            className="inspector-icon-btn is-danger"
                                            title="연결 제거"
                                            aria-label="연결 제거"
                                            // 후행은 **상대**가 내 id 를 들고 있다 → holderId 는 상대
                                            onClick={() => onRemoveDependency(e.id, e.depId)}
                                        >
                                            <X size={12} aria-hidden="true" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <button
                            type="button"
                            className="inspector-add-btn"
                            data-testid="inspector-link"
                            disabled={!canLink}
                            title={canLink ? '클릭 후 타임라인에서 상대를 고른다' : '타임라인 뷰에서만 연결할 수 있다'}
                            onClick={() => onStartLinking(focusedRangeId || task.id)}
                        >
                            <Link2 size={13} aria-hidden="true" />
                            {focusedRangeId ? ' 이 기간에 연결 추가' : ' 연결 추가'}
                        </button>
                    </section>

                    <DividerSection task={task} onUpdateTask={onUpdateTask} />

                    <section className="inspector-section">
                        <button
                            type="button"
                            className="inspector-delete-btn"
                            data-testid="inspector-delete"
                            onClick={() => {
                                if (window.confirm('정말 이 작업을 삭제하시겠습니까?')) onDeleteTask(task.id);
                            }}
                        >
                            <Trash2 size={13} aria-hidden="true" /> 작업 삭제
                        </button>
                    </section>
                </div>
            )}
        </aside>
    );
}

export default InspectorPanel;
