import React from 'react';
import './ColorPicker.css';

const DEFAULT_COLORS = [
    '#4A90E2', // Blue
    '#5CB85C', // Green
    '#7B68EE', // Purple
    '#F0AD4E', // Orange/Yellow
    '#9B59B6', // Violet
    '#D9534F', // Red
    '#E67E22', // Dark Orange
    '#34495e', // Dark Blue
];

function ColorPicker({ color, onChange, colors = DEFAULT_COLORS }) {
    return (
        <div className="color-picker-container">
            <div className="color-grid">
                {colors.map((c) => (
                    <div
                        key={c}
                        className={`color-option ${color === c ? 'selected' : ''}`}
                        style={{ backgroundColor: c }}
                        onClick={() => onChange(c)}
                        title={c}
                    />
                ))}
                <label className="color-option custom-color-picker" title="사용자 지정 색상">
                    <input
                        type="color"
                        value={color}
                        onChange={(e) => onChange(e.target.value)}
                    />
                    <span className="plus-icon">+</span>
                </label>
            </div>
        </div>
    );
}

export default ColorPicker;
