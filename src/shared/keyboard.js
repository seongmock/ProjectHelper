// 창 전체(window)에 걸리는 키보드 정책. **판정만 하고 실행하지 않는다.**
//
// window keydown 리스너는 둘이다 — 전역 단축키(App.jsx)와 선택 작업 단축키
// (features/tasks/useTaskKeyboard). "지금 이 키를 가로채도 되는가"의 판정이 두 곳으로
// 갈라져 있으면 한쪽만 고쳐지는데, 실제로 그랬다: 선택 작업 쪽은 입력 중·모달 뒤를 막고
// 있었지만 전역 쪽에는 가드가 아예 없었다.

// 어떤 입력 요소든 "입력 중"이다 — 날짜 input 안에서 ↑ 는 값 증가고, 작업명 편집 중의
// `[` 는 그냥 글자다. 수식어 없는 키를 가로채면 안 되는 자리.
export const isTypingTarget = (el) =>
    !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable === true);

// 그중 **텍스트를 편집하는** 자리. 여기서 Ctrl+Z 는 입력칸의 것이다 — 앱이 가져가면
// 사용자는 방금 친 글자를 되돌릴 방법을 잃고, 대신 직전의 트리 변경이 되돌아간다.
// 슬라이더·체크박스·색상·날짜 input 은 빠진다: 되돌릴 텍스트가 없고(값 자체가 즉시
// 트리에 커밋된다) 그 자리에서 Ctrl+Z 의 유일한 의미는 앱의 실행 취소다.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

export const isTextEditableTarget = (el) => {
    if (!el) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(String(el.type || 'text').toLowerCase());
};

// 모달이 열려 있으면 그쪽이 화면의 주인이다. 뒤에 가려진 트리를 조용히 바꾸면 안 된다.
// **새 오버레이를 만들면 `.modal-overlay` 를 쓰거나 여기 셀렉터에 추가해야 한다.**
export const hasOverlay = () => !!document.querySelector('.modal-overlay');

// Ctrl 조합 → 명령 이름. `shift+` 접두어가 붙은 항목만 Shift 를 요구한다.
// **키는 소문자로 정규화해서 찾는다** — Shift 나 CapsLock 이 켜지면 `key` 가 'Z' 로 온다.
// 예전 구현은 다시 실행을 `key === 'z' && shiftKey` 로 찾고 있어서 Ctrl+Shift+Z 가 아예
// 발화하지 않았고(Ctrl+Y 만 살아 있었다), CapsLock 이 켜지면 Ctrl+Z 까지 죽었다.
const KEYMAP = {
    k: 'palette',
    s: 'exportFile',
    n: 'addTask',
    z: 'undo',
    y: 'redo',
    'shift+z': 'redo',
};

// 트리를 바꾸는 명령. 입력 중이거나 모달 뒤면 발화하지 않는다.
// 나머지(팔레트 토글·파일 내보내기)는 트리를 바꾸지 않으므로 막지 않는다. 팔레트는 특히
// 막으면 안 된다 — 자기 자신이 오버레이라서 Ctrl+K 로 닫을 수 없게 된다. 내보내기는
// 결과가 브라우저 다운로드로 드러나고, 막으면 Ctrl+S 가 "페이지 저장"으로 새어 나간다.
const MUTATES_TREE = new Set(['undo', 'redo', 'addTask']);

/**
 * 전역 단축키 판정. KeyboardEvent 를 그대로 넘겨도 되고(읽는 것은 아래 6개 필드뿐)
 * 평범한 객체를 넘겨도 된다.
 *
 * @param {{key, ctrlKey, shiftKey, altKey, metaKey, defaultPrevented}} event
 * @param {{textEditing?: boolean, overlay?: boolean}} context
 * @returns {string|null} 명령 이름, 없으면 null (= 브라우저에 맡긴다)
 */
export function resolveGlobalShortcut(event, context = {}) {
    const { key, ctrlKey, shiftKey, altKey, metaKey, defaultPrevented } = event;
    // alt/meta: Ctrl+Alt(=AltGr) 로 글자를 넣는 자판과 OS 단축키를 빼앗지 않는다.
    if (defaultPrevented || !ctrlKey || altKey || metaKey) return null;

    const normalized = String(key).toLowerCase();
    const command = KEYMAP[shiftKey ? `shift+${normalized}` : normalized];
    if (!command) return null;
    if (MUTATES_TREE.has(command) && (context.textEditing || context.overlay)) return null;
    return command;
}
