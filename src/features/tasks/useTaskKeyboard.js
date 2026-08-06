// 선택된 작업을 키보드만으로 다루기 위한 단축키.
//
// 실사 §5.3: 타임라인 바는 마우스 드래그 전용이라 **키보드로는 일정을 바꿀 방법이 아예
// 없었다**. 여기서 다루는 것은 그 구멍뿐이다 — 전역 단축키(Ctrl+Z/S/N)는 App.jsx 에 있다.
//
//   ↑ / ↓        보이는 작업 목록에서 선택 이동 (접힌 자식은 건너뛴다)
//   [ / ]        선택 작업의 일정을 하루 앞/뒤로
//   { / }        (Shift) 일주일 앞/뒤로
//   Alt + [ / ]  종료일만 하루 줄이기/늘리기
import { useEffect } from 'react';
import { flattenTasks } from '../../utils/dataModel';
import { shiftTaskDates } from '../../utils/taskTree';

// 입력 중에는 어떤 키도 가로채지 않는다. 날짜 input 안에서 ↑ 는 값 증가고,
// 작업명 편집 중의 `[` 는 그냥 글자다.
const isTyping = (el) =>
    !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

// 모달·팝오버가 열려 있으면 그쪽이 화면의 주인이다. 뒤에 가려진 선택 작업을
// 조용히 움직이면 안 된다 (Escape 처리는 각 컴포넌트가 이미 한다).
const hasOverlay = () => !!document.querySelector('.modal-overlay, .timeline-popover');

// 이동/기간 조정 단축키 → [일수, 모드]. Shift 는 별도 플래그가 아니라 다른 문자로 온다.
const SHIFT_KEYS = {
    '[': [-1, 'move'],
    ']': [1, 'move'],
    '{': [-7, 'move'],
    '}': [7, 'move'],
};

export function useTaskKeyboard({ tasks, selectedTaskId, onSelect, onUpdateTask, toast }) {
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.ctrlKey || e.metaKey || e.defaultPrevented || isTyping(e.target)) return;
            if (hasOverlay()) return;

            const flat = flattenTasks(tasks);
            if (flat.length === 0) return;

            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const step = e.key === 'ArrowDown' ? 1 : -1;
                const current = flat.findIndex(t => t.id === selectedTaskId);
                // 선택이 없으면 ↓ 는 첫 작업, ↑ 는 마지막 작업 — 키보드만으로 진입할 수 있어야 한다
                const next = current === -1
                    ? (step === 1 ? 0 : flat.length - 1)
                    : Math.min(Math.max(current + step, 0), flat.length - 1);
                e.preventDefault();
                onSelect(flat[next].id);
                // 표 뷰와 타임라인 뷰의 선택 행 클래스가 다르다
                requestAnimationFrame(() => {
                    document.querySelector('.task-row.selected, .task-name-item.selected')
                        ?.scrollIntoView({ block: 'nearest' });
                });
                return;
            }

            const shift = SHIFT_KEYS[e.key];
            if (!shift) return;

            const task = flat.find(t => t.id === selectedTaskId);
            if (!task) return;
            e.preventDefault();

            // Alt 는 이동 대신 기간 조정 — 방향(부호)은 그대로 쓴다
            const [days, mode] = e.altKey ? [shift[0] > 0 ? 1 : -1, 'resize'] : shift;
            const patch = shiftTaskDates(task, days, mode);
            if (!patch) {
                toast.warn('일정이 없는 작업입니다 — 먼저 기간을 추가하세요');
                return;
            }
            onUpdateTask(task.id, patch);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [tasks, selectedTaskId, onSelect, onUpdateTask, toast]);
}
