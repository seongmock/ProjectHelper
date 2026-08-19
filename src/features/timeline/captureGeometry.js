// PNG 캡처가 잘라 낼 높이를 정한다.
//
// 높이는 DOM 이 아니라 **데이터로** 계산한다 — 캡처 중에 컨테이너의 overflow/height 를
// 덮어쓰기 때문에 그 순간의 실측값은 신뢰할 수 없다. 대신 레이아웃이 바뀌면 이 계산이
// 조용히 어긋난다는 대가가 있고, 실제로 어긋났다: 첫 행 위 라벨 자리로 `.timeline-content`
// 에 42px 여백이 생기자 그림에서 **마지막 행이 통째로 잘렸다**(행 높이 40px < 여백 42px).
// 그래서 판정을 여기로 꺼내 둔다 — E2E 가 같은 함수에 실측 입력을 넣어 마지막 행 바닥을
// 덮는지 확인한다. 계산만 고치면 다음 레이아웃 변경에서 똑같이 재발한다.
export const captureHeight = ({ headerHeight, contentPadTop, rowCount, rowHeight, scrollHeight }) => {
    const height = headerHeight + contentPadTop + rowCount * rowHeight;
    // 행이 하나도 없으면 계산할 것이 없다 — 그때만 실측 스크롤 높이로 물러선다.
    if (rowCount === 0) return Math.max(height, scrollHeight || 0);
    return Math.max(height, headerHeight + 50);
};
