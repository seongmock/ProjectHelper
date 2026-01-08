import React, { useState } from 'react';
import './PromptGuideModal.css';

const SYSTEM_PROMPT = `**역할 (Role)**:
당신은 React 기반의 간트 차트(Gantt Chart) 애플리케이션을 위한 데이터 생성 전문가입니다. 사용자의 자연어 설명이나 이미지 내용을 분석하여, 시스템이 이해할 수 있는 완벽한 JSON 구조로 변환하는 것이 임무입니다.

**시스템 컨텍스트 (System Context)**:
이 애플리케이션은 다음 기능들을 지원합니다:
1.  **계층 구조 (Hierarchy)**: 작업(Task)은 \`children\` 배열을 통해 무한 깊이의 하위 작업을 가질 수 있습니다.
2.  **타임라인 (Timeline)**: 모든 작업은 \`startDate\`와 \`endDate\`를 가집니다.
3.  **마일스톤 (Milestone)**: 작업 내에 \`milestones\` 배열로 중요 이벤트를 표시합니다. (모양: star, diamond, flag, circle, square, triangle)
4.  **의존성 (Dependencies)**: \`dependencies\` 배열에 선행 작업의 ID를 넣어 연결 관계를 표현합니다.
5.  **구분선 (Divider)**: 작업 하단에 \`divider\` 객체를 추가하여 시각적 구분을 줄 수 있습니다.

**데이터 스키마 (JSON Schema)**:
반드시 아래 형식을 준수해야 합니다.

\`\`\`json
{
  "meta": {
    "viewSettings": {
      "timeScale": "monthly", // "monthly" 또는 "quarterly"
      "viewMode": "timeline"  // "timeline" 고정
    }
  },
  "data": [
    {
      "id": "unique_id_1",       // 고유한 문자열 ID
      "name": "작업 이름",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "color": "#HexColor",      // 예: #4A90E2
      "expanded": true,          // 하위 작업 펼침 여부
      "description": "설명 (선택)",
      
      "children": [],            // 하위 작업이 있을 경우 재귀적으로 동일 구조 포함

      "milestones": [            // 마일스톤이 있을 경우
        {
          "id": "ms_id_1",
          "date": "YYYY-MM-DD",
          "label": "마일스톤 이름",
          "shape": "star",       // star, diamond, flag, circle, square, triangle 중 택 1
          "color": "#HexColor",
          "labelPosition": "top" // top, bottom, right 중 택 1
        }
      ],

      "dependencies": ["target_id_1"], // 선행 작업의 ID 목록

      "divider": {               // 구분선이 필요할 경우
        "enabled": true,
        "style": "solid",        // solid, dashed, dotted
        "color": "#DDDDDD",
        "thickness": 1
      }
    }
  ]
}
\`\`\`

**생성 규칙 (Rules)**:
1.  **날짜 추론**: 사용자가 정확한 날짜를 명시하지 않은 경우, 문맥에 맞는 합리적인 기간(예: 1월 = 01-01 ~ 01-31)을 할당하세요.
2.  **ID 생성**: 모든 \`id\`는 고유해야 합니다 (예: task_1, task_1_1).
3.  **시각화**: 단계별로 서로 다른 색상(\`color\`)을 사용하여 시각적으로 구분되게 하세요.
4.  **출력 형식**: 설명이나 사족 없이, 오직 **JSON 코드 블록** 하나만 출력하세요.`;

const PROMPTS = [
    {
        category: "📅 원클릭 AI 일정 생성 (통합 프롬프트)",
        items: [
            {
                title: "🖼️ 이미지/스크린샷 분석 및 변환",
                content: `${SYSTEM_PROMPT}

---

**사용자 요청 (User Request)**:
"이 이미지에 있는 프로젝트 일정(간트 차트, 표 등)을 분석해서 위의 JSON 형식으로 변환해줘.
1. 이미지의 작업 목록(Task Name)과 계층 구조(들여쓰기 등)를 정확히 반영해줘.
2. 타임라인 막대(Bar)의 길이를 보고 시작일과 종료일을 최대한 정확하게 추정해줘.
3. 주요 마일스톤(다이아몬드, 별 모양 등)도 \`milestones\`로 포함해줘.
4. 각 단계별로 색상을 다르게 지정해서 시각적으로 구분해줘."`
            },
            {
                title: "📝 텍스트/요구사항 기반 생성",
                content: `${SYSTEM_PROMPT}

---

**사용자 요청 (User Request)**:
"위의 규칙에 따라, 다음 요구사항을 바탕으로 일정 데이터를 JSON으로 생성해줘.

[요구사항 입력]:
'2026년 신제품 런칭 로드맵을 짜줘. 1월 기획, 2~3월 디자인, 4~5월 개발, 6월 출시 순서로 진행해. 각 단계 사이에는 의존성을 걸어주고, 출시일에는 Flag 모양 마일스톤을 넣어줘.'"`
            }
        ]
    }
];

function PromptGuideModal({ isOpen, onClose }) {
    if (!isOpen) return null;

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
        alert('프롬프트가 복사되었습니다! 📋');
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content prompt-guide-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>🤖 AI 프롬프트 가이드</h2>
                    <button className="close-button" onClick={onClose}>×</button>
                </div>
                <div className="modal-body">
                    <p className="guide-description">
                        상황에 맞는 프롬프트를 복사하여 AI 어시스턴트에게 붙여넣기 하세요.
                    </p>

                    <div className="prompt-categories">
                        {PROMPTS.map((category, idx) => (
                            <div key={idx} className="prompt-category">
                                <h3>{category.category}</h3>
                                <div className="prompt-list">
                                    {category.items.map((item, itemIdx) => (
                                        <div key={itemIdx} className="prompt-item">
                                            <div className="prompt-header">
                                                <span className="prompt-title">{item.title}</span>
                                                <button
                                                    className="copy-button"
                                                    onClick={() => handleCopy(item.content)}
                                                >
                                                    복사
                                                </button>
                                            </div>
                                            <div className="prompt-preview">
                                                {item.content}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default PromptGuideModal;
