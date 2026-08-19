// 좌측 프로젝트 레일이 그리는 배지의 순수 계산.
//
// 얇은 레일에는 이름이 들어가지 않는다 — 남는 것은 글자 하나와 색뿐이라, 그 둘이
// 프로젝트를 구분하는 유일한 단서가 된다. 그래서 두 가지를 지킨다:
//   - 색은 **id 에서** 뽑는다. 이름에서 뽑으면 이름을 고치는 순간 색이 바뀌어,
//     사용자가 위치와 색으로 외운 프로젝트가 다른 것처럼 보인다.
//   - 글자는 **이름에서** 뽑는다. id 는 사용자가 읽은 적 없는 문자열이다.
const HUE_MAX = 360;

// 문자열 해시(djb2 계열) — 같은 id 는 항상 같은 색, 다른 id 는 대체로 다른 색.
export function projectHue(id) {
    const key = String(id ?? '');
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    return hash % HUE_MAX;
}

export function projectColor(id) {
    return `hsl(${projectHue(id)}, 52%, 45%)`;
}

// 첫 글자 하나. Array.from 이어야 이모지·서러게이트 쌍이 반쪽으로 잘리지 않는다.
export function projectInitial(name) {
    const chars = Array.from(String(name ?? '').trim());
    return chars.length > 0 ? chars[0].toUpperCase() : '?';
}
