import { useState } from 'react';
import './Tooltip.css';

function Tooltip({ content, children, position = 'top' }) {
    const [show, setShow] = useState(false);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

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
                    className="tooltip-content-fixed"
                    style={{
                        left: `${mousePos.x + 10}px`,
                        top: `${mousePos.y + 10}px`
                    }}
                >
                    {content}
                </div>
            )}
        </div>
    );
}

export default Tooltip;
