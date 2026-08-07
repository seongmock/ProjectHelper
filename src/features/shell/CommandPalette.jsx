// 명령 팔레트 (Ctrl+K) — 실사 §5.4-13.
//
// 기능이 툴바·표시 옵션 메뉴·헤더·인스펙터에 흩어져 있고 상당수가 아이콘뿐이라,
// "그 기능이 어디 있었지"를 아는 사람만 쓸 수 있었다. 여기서는 **이름으로** 찾는다.
// 목록과 점수는 전부 commandPalette.js 의 순수함수가 만든다 — 이 파일은 그리기만 한다.
//
// 껍데기는 공용 Modal 이다. 그래야 Escape·오버레이 클릭·`.modal-overlay` 가 한 벌로
// 오고, useTaskKeyboard 의 hasOverlay() 가 팔레트 뒤에서 작업이 움직이는 것을 막는다.
import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../../shared/ui/Modal';
import { buildTaskItems, filterItems } from './commandPalette';
import './CommandPalette.css';

// 작업 수는 제한이 없다 — 다 그리면 목록이 아니라 스크롤 지옥이 된다
const TASK_LIMIT = 30;

const Highlighted = ({ text, indices }) => {
    if (!indices || indices.length === 0) return text;
    const hit = new Set(indices);
    return [...text].map((ch, i) => (
        hit.has(i) ? <mark key={i}>{ch}</mark> : <span key={i}>{ch}</span>
    ));
};

function CommandPalette({ isOpen, onClose, commands, tasks, onJumpToTask }) {
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    const taskItems = useMemo(() => buildTaskItems(tasks), [tasks]);

    const results = useMemo(() => {
        const hits = filterItems(commands, query);
        // 질의가 비었을 때 작업까지 나열하면 명령이 묻힌다. 이름을 치기 시작하면 합친다.
        if (!query.trim()) return hits;
        return [...hits, ...filterItems(taskItems, query, TASK_LIMIT)];
    }, [commands, taskItems, query]);

    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        setActiveIndex(0);
        inputRef.current?.focus();
    }, [isOpen]);

    // 키보드로 내려간 항목이 화면 밖이면 따라간다 (block:'nearest' — 보이면 안 움직인다)
    useEffect(() => {
        listRef.current?.querySelector('.command-item.active')?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    if (!isOpen) return null;

    const runEntry = (entry) => {
        if (!entry) return;
        // 먼저 닫는다 — 실행이 다른 모달을 여는 명령들이 있다(가져오기·스냅샷)
        onClose();
        if (entry.item.taskId) onJumpToTask(entry.item.taskId);
        else entry.item.run?.();
    };

    const move = (delta) => setActiveIndex(i => (
        results.length === 0 ? 0 : (i + delta + results.length) % results.length
    ));

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault();
            move(1);
        } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
            e.preventDefault();
            move(-1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            runEntry(results[activeIndex]);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="명령 팔레트" className="command-palette" width={560}>
            <input
                ref={inputRef}
                className="command-palette-input"
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
                onKeyDown={handleKeyDown}
                placeholder="명령 또는 작업 이름…"
                aria-label="명령 또는 작업 검색"
                aria-controls="command-palette-list"
                aria-activedescendant={results.length > 0 ? `command-item-${activeIndex}` : undefined}
                data-testid="command-palette-input"
            />

            <div className="command-list" id="command-palette-list" role="listbox" ref={listRef}>
                {results.length === 0 && (
                    <div className="command-empty">일치하는 명령이나 작업이 없습니다</div>
                )}
                {results.map((entry, i) => (
                    <div
                        key={entry.item.id}
                        id={`command-item-${i}`}
                        role="option"
                        aria-selected={i === activeIndex}
                        className={`command-item ${i === activeIndex ? 'active' : ''}`}
                        onMouseMove={() => setActiveIndex(i)}
                        onClick={() => runEntry(entry)}
                        data-testid="command-item"
                    >
                        <span className="command-group">{entry.item.group}</span>
                        <span className="command-label">
                            <Highlighted text={entry.item.label} indices={entry.indices} />
                        </span>
                        {entry.item.hint && <span className="command-hint">{entry.item.hint}</span>}
                        {entry.item.state && <span className="command-state">{entry.item.state}</span>}
                        {entry.item.shortcut && <kbd className="command-shortcut">{entry.item.shortcut}</kbd>}
                    </div>
                ))}
            </div>

            <div className="command-footer">
                <span>↑↓ 이동</span>
                <span>Enter 실행</span>
                <span>Esc 닫기</span>
            </div>
        </Modal>
    );
}

export default CommandPalette;
