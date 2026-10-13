import { useEffect, useRef, useState } from 'react';

// 텍스트 편집은 **blur/Enter 에 커밋**한다. 글자마다 커밋하면 undo 히스토리(최대 20칸)가
// 타이핑만으로 가득 차서 직전 작업을 되돌릴 수 없게 된다. 표(TaskRow)의 이름 편집도 같은
// 방식이다. Escape 는 편집을 버린다.
export default function DraftField({ tag: Tag = 'input', value, onCommit, ...rest }) {
    const [draft, setDraft] = useState(value);
    const isEditing = useRef(false);
    // Escape 로 버린 편집을 blur 가 다시 커밋하지 않게. setDraft(value) 는 다음 렌더에야 보이므로,
    // 같은 이벤트 안에서 도는 onBlur 의 commit 은 아직 편집된 draft 를 들고 있다 — 그래서 Escape 가
    // 편집을 버리는 대신 저장했다(2026-10-13 레드팀 2차). 표의 이름 편집은 이미 버린다.
    const cancelled = useRef(false);

    // 바깥(다른 편집 표면·undo·AI 쓰기)에서 값이 바뀌면 따라간다. 편집 중에는 덮지 않는다.
    useEffect(() => {
        if (!isEditing.current) setDraft(value);
    }, [value]);

    const commit = () => {
        isEditing.current = false;
        if (cancelled.current) {
            cancelled.current = false;
            return;
        }
        // onCommit 이 false 를 돌려주면 거절이다(예: 빈 이름) — 화면도 원래 값으로 되돌린다
        if (draft !== value && onCommit(draft) === false) setDraft(value);
    };

    return (
        <Tag
            {...rest}
            value={draft}
            onChange={(e) => { isEditing.current = true; setDraft(e.target.value); }}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && Tag === 'input') e.currentTarget.blur();
                if (e.key === 'Escape') {
                    isEditing.current = false;
                    cancelled.current = true;
                    setDraft(value);
                    e.currentTarget.blur();
                }
            }}
        />
    );
}
