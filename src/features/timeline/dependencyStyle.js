// 의존성 화살표를 "어떤 선으로 그리는가". 순수 상수와 순수함수만 — **import 이 하나도
// 없다.** dependencyPath.js 와 같은 이유로 별도 파일이다: 내보낸 HTML 이 이 소스를 그대로
// 심어서 쓴다(`htmlExporter.js` 의 `inlineModuleSource`). import 이 있으면 심을 수 없다.
//
// 왜 공유하는가: 내보내기는 **모든 연결을 회색 점선 하나로** 그리고 있었다. 앱은 순환을
// 빨간 실선, 일정 위반을 주황 파선으로 구분해 말하는데, 그 화면을 컨플루언스에 붙이는
// 순간 문제가 있던 연결과 없던 연결이 똑같아 보인다 — 문서를 보는 사람에게는 아무 문제도
// 없는 계획으로 읽힌다. 색만으로 구분하지 않는 것(§5.3)도 여기서 함께 지킨다: 색·선 모양·
// 굵기·설명이 한 벌로 붙어 다닌다.

export const DEPENDENCY_ISSUE_STYLES = {
    cycle: { stroke: '#dc2626', dash: null, width: 2.5, title: '순환 의존성 — 이 연결이 고리를 닫는다' },
    overlap: { stroke: '#f59e0b', dash: '6 3', width: 2.5, title: '일정 위반 — 후행이 선행 종료보다 먼저 시작한다' },
};
export const DEPENDENCY_NORMAL_STYLE = { stroke: '#999', dash: '4 2', width: 2, title: null };
// 끝이 화면에 없어 대표 행으로 끌어올린 선 — 더 촘촘한 점선이라 "이 행 자신의 연결이
// 아니다"가 색 없이도 읽힌다. 어느 자손의 것인지는 툴팁이 이름으로 말한다.
// (내보내기는 트리를 전부 펼쳐 그리므로 이 상태가 나오지 않는다.)
export const DEPENDENCY_ROLLED_UP_STYLE = { stroke: '#999', dash: '2 3', width: 2, title: null };
// 화면 밖으로 나가는 연결의 표식. 오류가 아니라 정보라서 빨강/주황을 쓰지 않고,
// 선이 아닌 **원**이라 색을 못 보아도 다른 간선과 구별된다.
export const DEPENDENCY_HIDDEN_STYLE = { stroke: '#0ea5e9', width: 2 };

export const dependencyStyleFor = (issue, rolledUp) =>
    DEPENDENCY_ISSUE_STYLES[issue] || (rolledUp ? DEPENDENCY_ROLLED_UP_STYLE : DEPENDENCY_NORMAL_STYLE);

// 이 화면이 정의해야 하는 화살촉 색 전부. 화살촉은 marker 라 stroke 를 물려받지 못한다.
export const dependencyStrokes = () => [...new Set([
    DEPENDENCY_NORMAL_STYLE.stroke,
    DEPENDENCY_ROLLED_UP_STYLE.stroke,
    DEPENDENCY_HIDDEN_STYLE.stroke,
    ...Object.keys(DEPENDENCY_ISSUE_STYLES).map(k => DEPENDENCY_ISSUE_STYLES[k].stroke),
])];

// scope 는 내보내기용이다 — 한 컨플루언스 페이지에 여러 개를 심어도 marker id 가 겹치면
// 안 된다(먼저 정의된 쪽의 색으로 전부 그려진다).
export const dependencyMarkerId = (stroke, scope) =>
    `arrowhead-${scope ? `${scope}-` : ''}${stroke.replace('#', '')}`;
