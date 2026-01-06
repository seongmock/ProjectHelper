import { useEffect, useRef } from 'react';
import './ColorPicker.css';

const PRESET_COLORS = [
    '#4A90E2', // Blue
    '#7B68EE', // Purple
    '#5CB85C', // Green
    '#F0AD4E', // Orange
    '#D9534F', // Red
    '#00BCD4', // Cyan
    '#9C27B0', // Deep Purple
    '#FF9800', // Amber
    '#FF5722', // Deep Orange
    '#795548', // Brown
    '#607D8B', // Blue Grey
    '#E91E63', // Pink
];

function ColorPicker({ currentColor, onColorChange, onClose }) {
    const pickerRef = useRef(null);

    // 외부 클릭 감지
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target)) {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    return (
        <div className="color-picker" ref={pickerRef}>
            <div className="color-preset-grid">
                {PRESET_COLORS.map((color) => (
                    <button
                        key={color}
                        className={`color-preset-item ${color === currentColor ? 'selected' : ''}`}
                        style={{ backgroundColor: color }}
                        onClick={() => onColorChange(color)}
                        title={color}
                    />
                ))}
            </div>
            <div className="color-custom">
                <label>
                    커스텀 색상:
                    <input
                        type="color"
                        value={currentColor}
                        onChange={(e) => onColorChange(e.target.value)}
                    />
                </label>
            </div>
        </div>
    );
}

export default ColorPicker;
