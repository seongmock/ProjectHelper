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

// gestureKey: 사용자 지정 색상 입력은 색 대화상자를 끄는 동안 값이 연달아 온다.
// 그 연속을 되돌리기 히스토리 한 칸으로 묶고 싶은 호출부가 이름을 준다(undoHistory.js).
// 팔레트 칩 클릭은 한 번의 이산적 조작이라 그대로 자기 칸을 갖는다.
function ColorPicker({ color, onChange, colors = DEFAULT_COLORS, gestureKey = null }) {
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
                        onChange={(e) => onChange(e.target.value, gestureKey)}
                    />
                    <span className="plus-icon">+</span>
                </label>
            </div>
        </div>
    );
}

export default ColorPicker;
