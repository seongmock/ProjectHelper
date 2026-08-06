// 타임라인의 가로 축 — 컨테이너 실측 폭 → 줌 반영 폭 → 날짜 범위 → 오늘 마커 위치.
// 계산은 utils/timelineGeometry.js 의 순수 함수가 하고, 여기서는 DOM 측정과 캐싱만 한다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeDateRange, computeTodayPosition } from './timelineGeometry';

export function useTimelineScale({ tasks, timeScale, showToday, zoomLevel, showTaskNames }) {
    const timelineScrollRef = useRef(null);
    const taskNamesScrollRef = useRef(null);
    const [containerWidth, setContainerWidth] = useState(0);

    // showTaskNames 가 바뀌면 스크롤 영역 자체가 교체되므로 관찰을 다시 건다
    useEffect(() => {
        if (!timelineScrollRef.current) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) setContainerWidth(entry.contentRect.width);
        });
        observer.observe(timelineScrollRef.current);
        return () => observer.disconnect();
    }, [showTaskNames]);

    // 세로 스크롤 동기화: 타임라인 → 작업명 컬럼 (두 컬럼의 행이 어긋나면 안 된다)
    useEffect(() => {
        const timeline = timelineScrollRef.current;
        const names = taskNamesScrollRef.current;
        if (!timeline || !names) return;
        const sync = () => { names.scrollTop = timeline.scrollTop; };
        timeline.addEventListener('scroll', sync);
        return () => timeline.removeEventListener('scroll', sync);
    }, [showTaskNames]);

    const dateRange = useMemo(
        () => computeDateRange(tasks, timeScale, showToday),
        [tasks, timeScale, showToday]
    );

    const contentWidth = containerWidth * zoomLevel;

    const todayPosition = useMemo(
        () => computeTodayPosition(dateRange, contentWidth, showToday),
        [dateRange, contentWidth, showToday]
    );

    return { timelineScrollRef, taskNamesScrollRef, dateRange, contentWidth, todayPosition };
}
