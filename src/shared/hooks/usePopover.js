import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// 화면 밖으로 나가지 않게 두는 여백
const MARGIN = 20;

/**
 * 앵커 좌표에 띄우는 팝오버의 공통 동작 — 뷰포트 클램핑 · 바깥 클릭 · Escape.
 *
 * 폐기된 TimelineBarPopover 와 MilestoneEditPopover 가 같은 코드를 각자 갖고 있었다.
 * 지금 남은 사용자는 MilestoneEditPopover 하나다.
 * `onDismiss` 는 매 렌더 새 함수여도 되도록 ref 로 최신값을 잡아둔다 — 리스너를
 * 다시 붙이지 않으므로 마우스다운 도중 핸들러가 교체되는 일이 없다.
 *
 * @param {{x:number,y:number}} position 클릭 지점(뷰포트 기준)
 * @param {() => void} onDismiss 바깥 클릭 / Escape 시 호출
 * @returns {{ popoverRef: import('react').RefObject<HTMLElement>, adjustedPos: {x:number,y:number} }}
 */
export function usePopover(position, onDismiss) {
    const popoverRef = useRef(null);
    const [adjustedPos, setAdjustedPos] = useState(position);

    const dismissRef = useRef(onDismiss);
    useEffect(() => {
        dismissRef.current = onDismiss;
    }, [onDismiss]);

    useLayoutEffect(() => {
        if (!popoverRef.current) return;
        const rect = popoverRef.current.getBoundingClientRect();
        let { x, y } = position;

        if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - MARGIN;
        if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - MARGIN;
        if (x < MARGIN) x = MARGIN;
        if (y < MARGIN) y = MARGIN;

        setAdjustedPos({ x, y });
    }, [position]);

    useEffect(() => {
        const handleMouseDown = (event) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target)) {
                dismissRef.current();
            }
        };
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') dismissRef.current();
        };

        document.addEventListener('mousedown', handleMouseDown);
        // 팝오버 안의 입력들이 keydown 을 stopPropagation 하므로 캡처 단계에서 받는다
        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('keydown', handleKeyDown, true);
        };
    }, []);

    return { popoverRef, adjustedPos };
}
