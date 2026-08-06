// 작업명 컬럼 폭 드래그 리사이즈.
// 드래그가 시작되면 리스너를 document 에 건다 — 커서가 핸들 밖으로 벗어나도 따라와야 한다.
import { useCallback, useEffect, useState } from 'react';

const MIN_WIDTH = 100;
const MAX_WIDTH = 600;

export function useSidebarResize(containerRef, initialWidth = 240) {
    const [sidebarWidth, setSidebarWidth] = useState(initialWidth);
    const [isResizing, setIsResizing] = useState(false);

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e) => {
            if (!containerRef.current) return;
            const left = containerRef.current.getBoundingClientRect().left;
            setSidebarWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX - left)));
        };
        const handleMouseUp = () => setIsResizing(false);

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'col-resize';

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'default';
        };
    }, [isResizing, containerRef]);

    const startResize = useCallback((e) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    return { sidebarWidth, isResizing, startResize };
}
