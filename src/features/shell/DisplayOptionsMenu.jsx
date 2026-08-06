import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    SlidersHorizontal, Check, Text, Tag, CalendarDays, CalendarClock, Rows3, Magnet,
} from 'lucide-react';
import { THEMES } from '../../themes/index.js';
import './DisplayOptionsMenu.css';

// CSS 의 min-width 와 맞춘다 — 오른쪽 화면 밖으로 나가지 않게 클램프할 때 쓴다
const MENU_WIDTH = 200;

// 툴바에 상시 노출되던 표시 토글 6종 + 차트 테마를 하나의 드롭다운으로 모은 것.
// 툴바가 좁은 화면에서 넘치던 근본 원인이 "모든 옵션이 항상 버튼"이었다.
function DisplayOptionsMenu({
    showTaskNames, onToggleTaskNames,
    showBarLabels, onToggleBarLabels,
    showBarDates, onToggleBarDates,
    showToday, onToggleToday,
    isCompact, onToggleCompact,
    snapEnabled, onToggleSnap,
    chartTheme, onThemeChange,
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [anchor, setAnchor] = useState({ top: 0, left: 0 });
    const triggerRef = useRef(null);
    const menuRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;
        const handleMouseDown = (e) => {
            const inTrigger = triggerRef.current?.contains(e.target);
            const inMenu = menuRef.current?.contains(e.target);
            if (!inTrigger && !inMenu) setIsOpen(false);
        };
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    // 툴바는 가로 스크롤(overflow-x)이 걸려 있어 자식으로 띄우면 메뉴가 잘린다 —
    // body 로 포털한 뒤 트리거 위치에 fixed 로 붙인다.
    const toggle = () => {
        if (!isOpen && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setAnchor({
                top: rect.bottom + 6,
                left: Math.min(rect.left, window.innerWidth - MENU_WIDTH - 12),
            });
        }
        setIsOpen(!isOpen);
    };

    const toggles = [
        { key: 'taskNames', Icon: Text, label: '작업명 컬럼', checked: showTaskNames, onChange: onToggleTaskNames },
        { key: 'barLabels', Icon: Tag, label: '바 이름', checked: showBarLabels, onChange: onToggleBarLabels },
        { key: 'barDates', Icon: CalendarDays, label: '바 날짜', checked: showBarDates, onChange: onToggleBarDates },
        { key: 'today', Icon: CalendarClock, label: '오늘 표시', checked: showToday, onChange: onToggleToday },
        { key: 'compact', Icon: Rows3, label: '컴팩트 행 높이', checked: isCompact, onChange: onToggleCompact },
        { key: 'snap', Icon: Magnet, label: '드래그 스냅', checked: snapEnabled, onChange: onToggleSnap },
    ];

    return (
        <div className="display-options">
            <button
                ref={triggerRef}
                className={`icon-btn ${isOpen ? 'active' : ''}`}
                onClick={toggle}
                title="표시 옵션"
                aria-haspopup="menu"
                aria-expanded={isOpen}
            >
                <SlidersHorizontal size={15} aria-hidden="true" />
                <span>표시 옵션</span>
            </button>

            {isOpen && createPortal(
                <div className="display-options-menu" role="menu" ref={menuRef} style={anchor}>
                    {toggles.map(({ key, Icon, label, checked, onChange }) => (
                        <button
                            key={key}
                            className="display-options-item"
                            role="menuitemcheckbox"
                            aria-checked={checked}
                            onClick={onChange}
                        >
                            <span className="display-options-check">
                                {checked && <Check size={14} aria-hidden="true" />}
                            </span>
                            <Icon size={15} aria-hidden="true" />
                            <span>{label}</span>
                        </button>
                    ))}

                    <div className="display-options-separator" role="separator" />
                    <div className="display-options-label">차트 테마</div>
                    {THEMES.map(theme => (
                        <button
                            key={theme.id}
                            className="display-options-item"
                            role="menuitemradio"
                            aria-checked={chartTheme === theme.id}
                            onClick={() => onThemeChange(theme.id)}
                        >
                            <span className="display-options-check">
                                {chartTheme === theme.id && <Check size={14} aria-hidden="true" />}
                            </span>
                            <span>{theme.label}</span>
                        </button>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
}

export default DisplayOptionsMenu;
