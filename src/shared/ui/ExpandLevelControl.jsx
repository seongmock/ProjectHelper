// 레벨별 일괄 접기/펼치기. 버튼 N = "N 단계까지만 보이게" 이므로 1 이 전부 접기이고
// 최대 깊이가 전부 펼치기다 — 열기/닫기 버튼을 따로 둘 필요가 없다.
//
// 검색 중에는 꺼진다: 필터가 조상을 강제로 펼치므로 화면에는 아무 일도 일어나지 않고
// 저장 데이터의 expanded 만 조용히 뒤집힌다(App.handleToggleExpand 와 같은 판단).
import './ExpandLevelControl.css';

function ExpandLevelControl({ depth, onSetDepth, disabled = false }) {
    if (depth < 2) return null; // 자식이 없으면 접을 것도 없다

    return (
        <span className="expand-level-control" onClick={(e) => e.stopPropagation()}>
            {Array.from({ length: depth }, (_, i) => i + 1).map(level => (
                <button
                    key={level}
                    type="button"
                    className="expand-level-btn"
                    disabled={disabled}
                    title={disabled ? '검색 중에는 쓸 수 없습니다' : `${level}단계까지 펼치기`}
                    aria-label={`${level}단계까지 펼치기`}
                    onClick={() => onSetDepth(level)}
                >
                    {level}
                </button>
            ))}
        </span>
    );
}

export default ExpandLevelControl;
