// 타임라인의 가로 축 — 컨테이너 실측 폭 → 줌 반영 폭 → 날짜 범위 → 오늘 마커 위치.
// 계산은 utils/timelineGeometry.js 의 순수 함수가 하고, 여기서는 DOM 측정과 캐싱만 한다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeDateRange, computeTodayPosition } from './timelineGeometry';

// 축의 오른쪽 끝에 남겨 두는 여백(px). 축은 마지막 달의 말일에서 끝나므로 말일의 마일스톤은
// 정확히 오른쪽 가장자리에 앉고, 마커의 오른쪽 반이 스크롤 영역 밖으로 잘렸다. 마커 반쪽(회전한
// 16px 다이아몬드 + hover 확대 ≈ 13px)이 들어갈 만큼만 뺀다. 축은 contentWidth 까지, 행·줄무늬·
// 머리글 바탕은 **scrollWidth(= contentWidth + 여백)** 까지 그린다 — 행을 축 폭에서 멈추던 동안 배율이
// 1 보다 크면 끝에 행 없는 빈 띠가 남았다.
export const END_GUTTER = 14;

export function useTimelineScale({ tasks, timeScale, showToday, zoomLevel, showTaskNames }) {
    const timelineScrollRef = useRef(null);
    const taskNamesScrollRef = useRef(null);
    const [containerWidth, setContainerWidth] = useState(0);

    // showTaskNames 가 바뀌면 스크롤 영역 자체가 교체되므로 관찰을 다시 건다
    useEffect(() => {
        if (!timelineScrollRef.current) return;
        const observer = new ResizeObserver((entries) => {
            // 캡처(useTimelineCapture)는 스크롤 영역을 펼치려고 크기를 덮어쓴다. 그것을 실측으로 받으면
            // 축이 그 폭 × 배율로 다시 넓어지고, 캡처가 또 펼치는 되먹임이 돈다 — 배율 2 에서 폭 36216px,
            // 배율 3 에서는 이미지가 나오지 않았다(2026-10-13 레드팀 2차). 캡처 중의 크기는 화면의 크기가 아니다.
            if (timelineScrollRef.current?.closest('.capturing')) return;
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

    return { timelineScrollRef, taskNamesScrollRef, dateRange, contentWidth, scrollWidth: contentWidth + END_GUTTER, todayPosition };
}
