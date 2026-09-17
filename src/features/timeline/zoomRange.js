// 확대 배율 — 한계값과 "이 구간을 화면에 꽉 채우려면 몇 배인가".
// 순수 함수만. 드래그 줌(TimelineView)과 숫자 입력(Toolbar)이 같은 한계를 본다.

export const ZOOM_MIN = 0.1;
// 상한이 없으면 드래그로 고른 얇은 조각 하나가 폭 수십만 px 을 만든다(브라우저가 멈춘다).
export const ZOOM_MAX = 20;

export const clampZoom = (zoom) =>
    Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(zoom) ? zoom : 1));

// 선택한 x 구간(콘텐츠 좌표계 px)이 뷰포트를 가득 채우는 배율과 그때의 스크롤 위치.
// 고를 것이 없으면(폭 0, 아직 실측 전) null — 호출부는 아무 일도 하지 않는다.
export const zoomToSelection = ({ x1, x2, contentWidth, zoomLevel, viewportWidth }) => {
    if (!(contentWidth > 0) || !(viewportWidth > 0)) return null;
    const left = Math.max(0, Math.min(x1, x2));
    const right = Math.min(contentWidth, Math.max(x1, x2));
    const span = right - left;
    if (!(span > 0)) return null;

    const zoom = clampZoom(zoomLevel * (contentWidth / span));
    const nextContentWidth = viewportWidth * zoom;
    // 배율이 상한에 걸리면 구간이 화면보다 넓게 남을 수 있다 — 그래도 왼쪽 끝은 맞춘다.
    const scrollLeft = (left / contentWidth) * nextContentWidth;
    return {
        zoomLevel: zoom,
        scrollLeft: Math.max(0, Math.min(scrollLeft, nextContentWidth - viewportWidth)),
    };
};
