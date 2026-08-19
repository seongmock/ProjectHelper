import { useLayoutEffect, useRef, useState } from 'react';
import { placeCursorTooltip } from './anchoredMenu';
import './Tooltip.css';

function Tooltip({ content, children, position = 'top' }) {
    const [show, setShow] = useState(false);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const boxRef = useRef(null);
    // 크기는 **내용이 바뀔 때만** 다시 잰다 — mousemove 마다 offsetWidth 를 읽으면 매
    // 이벤트가 레이아웃을 강제한다. 좌표만 커서를 따라가고, 클램프는 잰 크기로 계산한다.
    const [size, setSize] = useState(null);

    useLayoutEffect(() => {
        if (!show) return;
        const el = boxRef.current;
        if (el) setSize({ width: el.offsetWidth, height: el.offsetHeight });
    }, [show, content]);

    if (!content) return children;

    const handleMouseMove = (e) => {
        setMousePos({ x: e.clientX, y: e.clientY });
    };

    return (
        <div
            className="tooltip-container"
            onMouseEnter={(e) => {
                setShow(true);
                setMousePos({ x: e.clientX, y: e.clientY });
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setShow(false)}
        >
            {children}
            {show && (
                <div
                    ref={boxRef}
                    className="tooltip-content-fixed"
                    style={placeCursorTooltip(
                        mousePos,
                        size ?? { width: 0, height: 0 },
                        { width: window.innerWidth, height: window.innerHeight },
                    )}
                >
                    {content}
                </div>
            )}
        </div>
    );
}

export default Tooltip;
