// 마일스톤 도형의 유일한 정의 — **순수하고 import 가 없다**.
//
// 왜 여기 하나로 모았나: 같은 도형을 세 곳이 각자 그리고 있었다. 표(`TaskRow`)는 글리프로
// (삼각형은 CSS border, 별·깃발은 ★·⚑ 텍스트), 차트(`TimelineBar`)는 div/SVG 로, 내보내기
// (`htmlExporter`)는 HTML 문자열로. 셋이 각자라서 같은 데이터가 화면마다 다른 그림이 됐고,
// 도형을 하나 추가하려면 세 군데(선택 목록까지 세면 다섯 군데)를 고쳐야 했다.
//
// 그림 자체를 공유하지 않고 **모양의 서술**을 공유한다: 표는 12px 미리보기라 흰 테두리와
// 그림자를 씌우면 도형이 잡아먹히고, 차트는 배경 위에 떠 있어야 하므로 그것이 필요하고,
// 내보내기는 React 를 쓸 수 없다(Confluence 에 심는 정적 `<div>` 조각이다). 서술을 나누고
// 표현은 각자 하면 "무엇을 그리는가"는 절대 어긋나지 않고 "어떻게 보이는가"는 맥락을 지킨다.
//
// import 가 없는 것은 의도다 — `htmlExporter` 가 이 파일의 **소스 자체**를 `?raw` 로 읽어
// 내보낸 스크립트에 심는다(`inlineModuleSource`). import 가 하나라도 있으면 그 경로가 깨진다.
// 같은 이유로 `export default`/`export { … }` 를 쓰지 않는다 — 심는 쪽은 `export ` 만 지운다.

// 선택 UI(인스펙터·빠른 추가)가 쓰는 순서 그대로. 글리프는 도형의 표현이므로 Lucide
// 아이콘으로 바꾸지 않는다 — 목록에서 고른 것과 차트에 그려진 것이 눈으로 대조되어야 한다.
export const MILESTONE_SHAPE_OPTIONS = [
    { value: 'diamond', label: '◆' },
    { value: 'circle', label: '●' },
    { value: 'square', label: '■' },
    { value: 'triangle', label: '▲' },
    { value: 'star', label: '★' },
    { value: 'flag', label: '⚑' },
];

// kind 'box'  — 정사각형 상자를 굴리거나 돌려서 만드는 도형 (원·사각형·다이아몬드)
// kind 'path' — 24×24 뷰박스의 SVG 경로 (삼각형·별·깃발)
const MILESTONE_SHAPE_SPECS = {
    diamond: { kind: 'box', borderRadius: null, rotate: 45 },
    circle: { kind: 'box', borderRadius: '50%', rotate: 0 },
    square: { kind: 'box', borderRadius: '2px', rotate: 0 },
    triangle: { kind: 'path', viewBox: '0 0 24 24', path: 'M12 2L22 22H2L12 2Z' },
    star: {
        kind: 'path', viewBox: '0 0 24 24',
        path: 'M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z',
    },
    flag: { kind: 'path', viewBox: '0 0 24 24', path: 'M14.4 6L14 4H5V21H7V14H12L12.4 16H22V6H14.4Z' },
};

// 모르는 이름은 다이아몬드다 — 세 구현이 이미 그렇게 하고 있었고, 저장된 데이터에는
// 검증이 없으므로(서버는 shape 를 보지 않는다) 빈 칸이 나오는 것보다 낫다.
export function milestoneShape(shape) {
    const spec = MILESTONE_SHAPE_SPECS[shape] || MILESTONE_SHAPE_SPECS.diamond;
    return { name: MILESTONE_SHAPE_SPECS[shape] ? shape : 'diamond', ...spec };
}
