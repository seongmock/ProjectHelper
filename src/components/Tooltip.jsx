import { useState } from 'react';
import './Tooltip.css';

function Tooltip({ content, children, position = 'top' }) {
    const [show, setShow] = useState(false);

    if (!content) return children;

    return (
        <div
            className="tooltip-container"
            onMouseEnter={() => setShow(true)}
            onMouseLeave={() => setShow(false)}
        >
            {children}
            {show && (
                <div className={`tooltip-content tooltip-${position}`}>
                    {content}
                </div>
            )}
        </div>
    );
}

export default Tooltip;
