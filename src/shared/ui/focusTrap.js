// 모달 포커스 가두기 — "다음에 어디로 보낼지" 판정과 후보 수집.
//
// 판정(nextTrapIndex)은 DOM 을 모르는 순수함수라 단위테스트가 규칙을 고정하고,
// 수집(getFocusableElements)만 DOM 을 만진다(그쪽 동작은 E2E 가 본다).

// tabindex 를 직접 붙인 요소까지 후보로 긁고 아래 필터에서 거른다 — 모달 껍데기
// 자신이 [tabindex="-1"] 이다.
const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[tabindex]',
].join(',');

// 화면에 없는 것은 포커스를 받을 수 없다(접힌 <details> 안, display:none 인 조상).
// offsetParent 는 position:fixed 요소에서 null 이라 렌더 박스도 함께 본다.
const isVisible = (el) => !!(el.offsetParent || el.getClientRects().length);

export function getFocusableElements(container) {
    if (!container) return [];
    return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(el => (
        !el.disabled
        && el.getAttribute('tabindex') !== '-1'
        && el.getAttribute('aria-hidden') !== 'true'
        && isVisible(el)
    ));
}

// 반환 규약:
//   null  → 가로채지 않는다. 후보 사이의 이동은 브라우저가 하는 것이 맞다
//           (읽기 순서·shift 조합·IME 를 우리가 다시 구현할 이유가 없다).
//   -1    → 컨테이너 자신에게 준다. 모달 안에 받을 것이 하나도 없을 때만이고,
//           그래도 포커스를 배경으로 내보내지 않는다.
//   그 외 → focusables[그 인덱스].
// activeIndex 가 -1 이면 지금 포커스가 후보 밖(컨테이너 자신 등)이라는 뜻이다.
export function nextTrapIndex(count, activeIndex, backward) {
    if (count === 0) return -1;
    if (backward) return activeIndex <= 0 ? count - 1 : null;
    return activeIndex === -1 || activeIndex === count - 1 ? 0 : null;
}
