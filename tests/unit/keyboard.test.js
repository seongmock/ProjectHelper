// 전역 단축키 판정 단위 테스트.
//
// 이 판정이 틀리면 양쪽으로 조용히 망가진다: 느슨하면 가려진 모달 뒤에서 트리가 바뀌고
// 입력칸의 Ctrl+Z(텍스트 되돌리기)를 앱이 빼앗는다. 과하면 단축키가 아무 반응이 없는데
// 사용자에게는 그것이 고장인지 정책인지 구분되지 않는다.
//
// 실제로 여기 있던 결함 4건이 전부 이 함수 하나로 모였다:
//   ① 입력 중에도 발화 → Ctrl+Z 가 텍스트 대신 트리를 되돌렸다
//   ② 모달 뒤에서도 발화 → 보이지 않는 곳에서 트리가 바뀌었다
//   ③ Ctrl+Shift+Z 가 아예 발화하지 않았다 (Shift 는 `key` 를 'Z' 로 만든다)
//   ④ CapsLock 이 켜지면 모든 글자 단축키가 죽었다 (같은 대소문자 문제)
import { describe, it, expect } from 'vitest';
import { resolveGlobalShortcut, isTextEditableTarget, isTypingTarget } from '../../src/shared/keyboard';

// KeyboardEvent 의 필드 중 판정이 읽는 것만 담은 최소 객체
const ev = (key, mods = {}) => ({
    key,
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    defaultPrevented: false,
    ...mods,
});

describe('resolveGlobalShortcut', () => {
    it('Ctrl 조합을 명령으로 옮긴다', () => {
        expect(resolveGlobalShortcut(ev('k'))).toBe('palette');
        expect(resolveGlobalShortcut(ev('z'))).toBe('undo');
        expect(resolveGlobalShortcut(ev('y'))).toBe('redo');
        expect(resolveGlobalShortcut(ev('s'))).toBe('exportFile');
        expect(resolveGlobalShortcut(ev('n'))).toBe('addTask');
    });

    // ③ 브라우저는 Shift 가 눌리면 `key` 를 'Z' 로 준다. 예전 구현은 'z' 를 찾고 있어서
    // 이 조합이 죽어 있었고 다시 실행은 Ctrl+Y 하나로만 가능했다.
    it('Ctrl+Shift+Z 는 다시 실행이다 — Shift 가 준 대문자 키로도 찾는다', () => {
        expect(resolveGlobalShortcut(ev('Z', { shiftKey: true }))).toBe('redo');
        expect(resolveGlobalShortcut(ev('z', { shiftKey: true }))).toBe('redo');
    });

    // ④ CapsLock 은 Shift 없이 대문자를 준다
    it('CapsLock 으로 대문자가 와도 같은 단축키다', () => {
        expect(resolveGlobalShortcut(ev('Z'))).toBe('undo');
        expect(resolveGlobalShortcut(ev('N'))).toBe('addTask');
        expect(resolveGlobalShortcut(ev('K'))).toBe('palette');
    });

    it('Shift 를 요구하지 않는 단축키에 Shift 를 붙이면 명령이 아니다', () => {
        // Ctrl+Shift+K(개발자도구)·Ctrl+Shift+S 같은 조합을 빼앗지 않는다
        expect(resolveGlobalShortcut(ev('K', { shiftKey: true }))).toBe(null);
        expect(resolveGlobalShortcut(ev('S', { shiftKey: true }))).toBe(null);
        expect(resolveGlobalShortcut(ev('Y', { shiftKey: true }))).toBe(null);
    });

    it('Ctrl 이 없거나 Alt/Meta 가 섞이면 우리 것이 아니다', () => {
        expect(resolveGlobalShortcut(ev('z', { ctrlKey: false }))).toBe(null);
        expect(resolveGlobalShortcut(ev('z', { altKey: true }))).toBe(null);   // AltGr 자판
        expect(resolveGlobalShortcut(ev('z', { metaKey: true }))).toBe(null);  // OS 단축키
    });

    it('이미 처리된 이벤트는 건드리지 않는다', () => {
        expect(resolveGlobalShortcut(ev('z', { defaultPrevented: true }))).toBe(null);
    });

    it('모르는 키는 null 이다', () => {
        expect(resolveGlobalShortcut(ev('a'))).toBe(null);
        expect(resolveGlobalShortcut(ev('Enter'))).toBe(null);
        expect(resolveGlobalShortcut(ev('ArrowDown'))).toBe(null);
    });

    // ① 텍스트 편집 중에는 Ctrl+Z 가 입력칸의 것이다
    it('텍스트 편집 중에는 트리를 바꾸는 명령이 발화하지 않는다', () => {
        const typing = { textEditing: true };
        expect(resolveGlobalShortcut(ev('z'), typing)).toBe(null);
        expect(resolveGlobalShortcut(ev('Z', { shiftKey: true }), typing)).toBe(null);
        expect(resolveGlobalShortcut(ev('y'), typing)).toBe(null);
        expect(resolveGlobalShortcut(ev('n'), typing)).toBe(null);
    });

    // ② 모달 뒤에서 트리가 조용히 바뀌면 안 된다
    it('모달이 떠 있으면 트리를 바꾸는 명령이 발화하지 않는다', () => {
        const overlay = { overlay: true };
        expect(resolveGlobalShortcut(ev('z'), overlay)).toBe(null);
        expect(resolveGlobalShortcut(ev('y'), overlay)).toBe(null);
        expect(resolveGlobalShortcut(ev('n'), overlay)).toBe(null);
    });

    it('트리를 바꾸지 않는 명령은 입력 중·모달 뒤에도 그대로 동작한다', () => {
        // 팔레트를 막으면 자기 자신이 오버레이라서 Ctrl+K 로 닫을 수 없게 된다.
        // 내보내기를 막으면 Ctrl+S 가 브라우저의 "페이지 저장"으로 새어 나간다.
        const blocked = { textEditing: true, overlay: true };
        expect(resolveGlobalShortcut(ev('k'), blocked)).toBe('palette');
        expect(resolveGlobalShortcut(ev('s'), blocked)).toBe('exportFile');
    });

    it('컨텍스트를 주지 않으면 아무것도 막지 않는다', () => {
        expect(resolveGlobalShortcut(ev('z'))).toBe('undo');
    });
});

// DOM 판정 두 개. 실제 요소는 E2E 가 보고, 여기서는 tagName/type 규칙만 고정한다.
describe('isTextEditableTarget', () => {
    it('텍스트를 담는 입력만 참이다', () => {
        expect(isTextEditableTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
        expect(isTextEditableTarget({ tagName: 'INPUT', type: 'search' })).toBe(true);
        expect(isTextEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
        expect(isTextEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
        // type 이 없는 input 은 text 다
        expect(isTextEditableTarget({ tagName: 'INPUT' })).toBe(true);
    });

    // 이 자리에서는 되돌릴 텍스트가 없다 — 값이 바로 트리에 커밋되므로
    // Ctrl+Z 의 유일한 의미가 앱의 실행 취소다.
    it('슬라이더·날짜·체크박스·색상은 텍스트 편집이 아니다', () => {
        expect(isTextEditableTarget({ tagName: 'INPUT', type: 'range' })).toBe(false);
        expect(isTextEditableTarget({ tagName: 'INPUT', type: 'date' })).toBe(false);
        expect(isTextEditableTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
        expect(isTextEditableTarget({ tagName: 'INPUT', type: 'color' })).toBe(false);
        expect(isTextEditableTarget({ tagName: 'SELECT' })).toBe(false);
        expect(isTextEditableTarget({ tagName: 'BUTTON' })).toBe(false);
        expect(isTextEditableTarget(null)).toBe(false);
    });
});

describe('isTypingTarget', () => {
    // 수식어 없는 키(↑↓ · [ ])는 어떤 입력 요소 안에서도 가로채지 않는다 —
    // 날짜 input 의 ↑ 는 값 증가고 select 의 ↑ 는 항목 이동이다.
    it('입력 요소면 종류를 가리지 않고 참이다', () => {
        expect(isTypingTarget({ tagName: 'INPUT', type: 'date' })).toBe(true);
        expect(isTypingTarget({ tagName: 'INPUT', type: 'range' })).toBe(true);
        expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
        expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
        expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    });

    it('그 밖에는 거짓이다', () => {
        expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
        expect(isTypingTarget({ tagName: 'DIV' })).toBe(false);
        expect(isTypingTarget(null)).toBe(false);
    });
});
