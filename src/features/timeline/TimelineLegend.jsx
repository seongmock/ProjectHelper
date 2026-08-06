// 상태 색상 범례. 상태 색상 모드일 때만 타임라인 아래에 붙는다.
//
// 색만으로 상태를 인코딩하면 색약 사용자가 구분할 수 없으므로, 스와치에 상태별 패턴
// (완료=채움, 진행중=채움+테두리, 예정=옅음, 지연=사선)을 함께 준다. CSS 는
// TimelineLegend.css 에 있다.
import { STATUS_STYLES } from '../../themes/index.js';
import './TimelineLegend.css';

function TimelineLegend() {
    return (
        <div className="timeline-legend" role="list" aria-label="상태 색상 범례">
            <span className="timeline-legend-title">상태</span>
            {STATUS_STYLES.map(({ id, label, color }) => (
                <span className="timeline-legend-item" role="listitem" key={id}>
                    <span
                        className={`timeline-legend-swatch status-${id}`}
                        style={{ '--swatch-color': color }}
                        aria-hidden="true"
                    />
                    {label}
                </span>
            ))}
        </div>
    );
}

export default TimelineLegend;
