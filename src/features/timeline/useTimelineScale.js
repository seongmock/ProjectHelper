// 타임라인의 가로 축 — 컨테이너 실측 폭 → 줌 반영 폭 → 날짜 범위 → 오늘 마커 위치.
// 계산은 utils/timelineGeometry.js 의 순수 함수가 하고, 여기서는 DOM 측정과 캐싱만 한다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeDateRange, computeTodayPosition } from './timelineGeometry';

// 축의 오른쪽 끝에 남겨 두는 여백(px). 축은 마지막 달의 말일에서 끝나므로 말일의 마일스톤은
// 정확히 오른쪽 가장자리에 앉고, 마커의 오른쪽 반이 스크롤 영역 밖으로 잘렸다. 마커 반쪽(회전한
// 16px 다이아몬드 + hover 확대 ≈ 13px)이 들어갈 만큼만 뺀다 — 여백만큼 .timeline-content 는
// min-width: 100% 로 채워져 줄무늬·행은 끝까지 간다.
const END_GUTTER = 14;

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

    const contentWidth = Math.max(0, containerWidth - END_GUTTER) * zoomLevel;

    const todayPosition = useMemo(
        () => computeTodayPosition(dateRange, contentWidth, showToday),
        [dateRange, contentWidth, showToday]
    );

    return { timelineScrollRef, taskNamesScrollRef, dateRange, contentWidth, todayPosition };
}
