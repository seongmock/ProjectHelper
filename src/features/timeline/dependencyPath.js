// 선행 → 후행 화살표의 경로. **의존성 없는 순수 모듈로 따로 둔다** — 내보낸 HTML 이
// 이 소스를 그대로 심어 쓰기 때문이다(htmlExporter.js). import 가 하나라도 붙으면 심을 수
// 없어지고, 그러면 내보내기가 같은 로직을 또 적게 된다. 실제로 그랬다: 두 구현이 나란히
// 있었고 한쪽만 조금씩 달랐다(같은 행 판정이 === 와 abs() < 1 로 갈렸다).

// 선행 → 후행 경로. 뒤로 가야 하는 경우(후행이 선행보다 왼쪽) 우회 경로를 만든다.
export const dependencyPath = (startX, startY, endX, endY) => {
    if (startX < endX - 40) {
        const midX = startX + 20;
        return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
    }
    if (startY === endY && startX < endX) {
        return `M ${startX} ${startY} L ${endX} ${endY}`; // 같은 행 · 정방향 → 직선
    }
    const backX = startX + 10;
    const forwardX = endX - 30;
    const midY = (startY + endY) / 2;
    return `M ${startX} ${startY} L ${backX} ${startY} L ${backX} ${midY} L ${forwardX} ${midY} L ${forwardX} ${endY} L ${endX} ${endY}`;
};
