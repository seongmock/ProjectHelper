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

// 배지 안의 글자는 흰색이다 — 그래서 밝기는 취향이 아니라 **대비의 결과**다.
// 채도 52% / 밝기 45% 를 모든 색조에 똑같이 쓰던 동안, 노랑·초록·시안 계열(360 중 183)은
// 흰 글자 대비가 4.5:1 에 못 미쳤다(노랑 hue 60 은 2.66:1 — 배지 글자가 사실상 안 보였다).
// 색조는 프로젝트를 구별하는 단서이므로 건드리지 않고, 밝기만 그 색조에서 AA 를 만족하는
// 가장 밝은 값으로 내린다. 계산은 여기서 한다 — CSS 로는 상대 휘도를 알 수 없다.
const SATURATION = 52;
const MAX_LIGHTNESS = 45;
const MIN_LIGHTNESS = 20;
const AA_CONTRAST = 4.5;

function hslToRgb(hue, saturation, lightness) {
    const h = hue / HUE_MAX;
    const s = saturation / 100;
    const l = lightness / 100;
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t) => {
        const x = (t % 1 + 1) % 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
    };
    return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

// WCAG 상대 휘도. 흰색(휘도 1)과의 대비는 1.05 / (L + 0.05) 이다.
function relativeLuminance([r, g, b]) {
    const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastWithWhite(hue, lightness) {
    return 1.05 / (relativeLuminance(hslToRgb(hue, SATURATION, lightness)) + 0.05);
}

// 그 색조에서 흰 글자가 AA 를 만족하는 **가장 밝은** 밝기. 1% 단위로 충분하다.
export function projectLightness(hue) {
    for (let l = MAX_LIGHTNESS; l > MIN_LIGHTNESS; l -= 1) {
        if (contrastWithWhite(hue, l) >= AA_CONTRAST) return l;
    }
    return MIN_LIGHTNESS;
}

export function projectColor(id) {
    const hue = projectHue(id);
    return `hsl(${hue}, ${SATURATION}%, ${projectLightness(hue)}%)`;
}

// 첫 글자 하나. Array.from 이어야 이모지·서러게이트 쌍이 반쪽으로 잘리지 않는다.
export function projectInitial(name) {
    const chars = Array.from(String(name ?? '').trim());
    return chars.length > 0 ? chars[0].toUpperCase() : '?';
}
