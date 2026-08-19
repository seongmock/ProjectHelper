// 트리거 버튼에 붙는 드롭다운의 좌표를 정하는 순수함수.
//
// 왜 공용이어야 하는가: 드롭다운은 **조상이 만든 쌓임 문맥에 갇힌다.** `.header`(z 100)나
// `.toolbar`(z 90) 처럼 position + z-index 가 붙은 조상 안에서는 자식의 z-index 를 얼마로
// 올려도 조상의 값으로 비교되므로, 뒤에 오는 차트 요소(마일스톤 z 200 등)가 메뉴 위에
// 그려진다. 해법은 숫자가 아니라 **body 로 포털 + position: fixed** 이고, 그러면 좌표를
// 직접 계산해야 한다 — 그 계산이 두 곳에 복제되면 한쪽만 고쳐진다.
//
// 판정 규칙:
//   1) 좌우는 트리거 왼쪽에 맞추고, 화면 밖으로 넘치면 안쪽으로 당긴다.
//   2) 상하는 아래를 우선하되, 아래가 모자라고 위가 더 넓으면 위로 뒤집는다.
//   3) 어느 쪽이든 **남는 높이를 maxHeight 로 돌려준다** — 잘리는 대신 스크롤하게 만드는
//      값이다. 메뉴가 화면보다 길면(테마 목록이 늘어나면) 이것 없이는 아래가 잘려서
//      마지막 항목을 클릭할 방법이 아예 없다.

export const MENU_GAP = 6;      // 트리거와 메뉴 사이
export const MENU_MARGIN = 8;   // 화면 가장자리 여백
export const MENU_MIN_HEIGHT = 120;

export function placeAnchoredMenu(trigger, menu, viewport, options = {}) {
    const gap = options.gap ?? MENU_GAP;
    const margin = options.margin ?? MENU_MARGIN;
    const width = Math.max(0, menu.width || 0);
    const height = Math.max(0, menu.height || 0);

    let left = trigger.left;
    if (left + width > viewport.width - margin) left = viewport.width - margin - width;
    if (left < margin) left = margin;

    const spaceBelow = viewport.height - margin - (trigger.bottom + gap);
    const spaceAbove = trigger.top - gap - margin;

    // 아래에 들어가면 아래. 안 들어가면 더 넓은 쪽으로 — "위가 더 넓다"가 아니라
    // "아래에 못 들어가고 위가 더 넓다"여야 한다. 그냥 넓은 쪽을 고르면 짧은 메뉴가
    // 이유 없이 위로 튀어 올라 읽는 순서가 흐트러진다.
    const flipUp = height > spaceBelow && spaceAbove > spaceBelow;
    const available = flipUp ? spaceAbove : spaceBelow;
    const top = flipUp
        ? Math.max(margin, trigger.top - gap - Math.min(height, spaceAbove))
        : trigger.bottom + gap;

    return {
        top: Math.round(top),
        left: Math.round(left),
        maxHeight: Math.max(MENU_MIN_HEIGHT, Math.floor(available)),
        placement: flipUp ? 'above' : 'below',
    };
}

// 커서를 따라다니는 툴팁(shared/ui/Tooltip)의 좌표. 메뉴와 달리 기준이 점이라 뒤집기가
// "반대쪽으로 미러링"이 된다.
//
// 예전에는 그냥 `left: x + 10; top: y + 10` 이었다 — 화면 오른쪽이나 아래쪽 끝에서 마우스를
// 올리면 툴팁이 뷰포트를 넘어가 **내용의 절반 이상이 잘렸다.** 타임라인은 가로로 길어서
// 오른쪽 끝의 바를 확인하는 일이 드물지 않다.
export const CURSOR_GAP = 10;

export function placeCursorTooltip(cursor, size, viewport, options = {}) {
    const gap = options.gap ?? CURSOR_GAP;
    const margin = options.margin ?? MENU_MARGIN;
    const width = Math.max(0, size.width || 0);
    const height = Math.max(0, size.height || 0);

    // 커서 오른쪽/아래가 기본. 안 들어가면 반대쪽으로 넘기고, 그래도 안 되면 여백에 붙인다
    // (툴팁이 화면보다 큰 경우 — 붙여 두는 편이 잘려 사라지는 것보다 낫다).
    let left = cursor.x + gap;
    if (left + width > viewport.width - margin) left = cursor.x - gap - width;
    if (left < margin) left = margin;

    let top = cursor.y + gap;
    if (top + height > viewport.height - margin) top = cursor.y - gap - height;
    if (top < margin) top = margin;

    return { top: Math.round(top), left: Math.round(left) };
}
