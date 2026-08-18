import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { placeAnchoredMenu } from './anchoredMenu';

// placeAnchoredMenu 를 실제 DOM 에 붙이는 훅. 열려 있는 동안 스크롤·리사이즈를 따라
// 다시 계산한다 — 열 때 한 번만 재면 사용자가 스크롤한 뒤 메뉴가 트리거에서 떨어져
// 허공에 남는다(position: fixed 라서 함께 움직이지 않는다).
//
// 반환값이 null 인 첫 프레임에는 아직 실측 크기가 없다. 그 프레임을 화면에 보이는 채로
// 두면 메뉴가 (0,0) 에서 제자리로 튀므로, 호출자는 visibility 로 감춘다.
export function useAnchoredMenu(isOpen, triggerRef, menuRef, fallback = { width: 240, height: 320 }) {
    const [pos, setPos] = useState(null);

    const place = useCallback(() => {
        const trigger = triggerRef.current?.getBoundingClientRect();
        if (!trigger) return;
        const el = menuRef.current;
        // 실측은 스크롤 높이로 한다 — maxHeight 를 이미 적용한 뒤에는 offsetHeight 가
        // 그 값으로 잘려 있어서, 그걸 다시 입력으로 쓰면 한 번 뒤집힌 메뉴가 계속 뒤집힌다.
        const menu = el
            ? { width: el.offsetWidth || fallback.width, height: el.scrollHeight || fallback.height }
            : fallback;
        const next = placeAnchoredMenu(trigger, menu, {
            width: window.innerWidth,
            height: window.innerHeight,
        });
        setPos(prev => (
            prev && prev.top === next.top && prev.left === next.left
                && prev.maxHeight === next.maxHeight && prev.placement === next.placement
                ? prev
                : next
        ));
    }, [triggerRef, menuRef, fallback.width, fallback.height]);

    useLayoutEffect(() => {
        if (!isOpen) {
            setPos(null);
            return undefined;
        }
        place();
        return undefined;
    }, [isOpen, place]);

    useEffect(() => {
        if (!isOpen) return undefined;
        window.addEventListener('resize', place);
        // capture: true — 메뉴를 띄운 채 스크롤되는 것은 대개 내부 컨테이너다
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [isOpen, place]);

    return pos;
}
