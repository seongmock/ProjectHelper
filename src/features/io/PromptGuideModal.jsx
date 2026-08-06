import React from 'react';
import { Bot } from 'lucide-react';
import Modal from '../../shared/ui/Modal';
import './PromptGuideModal.css';

const SYSTEM_PROMPT = `**역할 (Role)**:
당신은 React 기반의 간트 차트(Gantt Chart) 애플리케이션을 위한 데이터 생성 전문가입니다. 사용자의 자연어 설명이나 이미지 내용을 분석하여, 시스템이 이해할 수 있는 완벽한 JSON 구조로 변환하는 것이 임무입니다.

**시스템 컨텍스트 (System Context)**:
이 애플리케이션은 다음 기능들을 지원합니다:
1.  **계층 구조 (Hierarchy)**: 작업(Task)은 \`children\` 배열을 통해 무한 깊이의 하위 작업을 가질 수 있습니다.
2.  **멀티 타임라인 (Multi-Time Ranges)**: 하나의 작업이 여러 개의 분리된 기간(\`timeRanges\`)을 가질 수 있습니다. (레거시 \`startDate/endDate\` 지원)
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

      "timeRanges": [            // (New) 단일 작업 내 다중 기간
        {
          "id": "range_id_1", 
          "startDate": "YYYY-MM-DD",
          "endDate": "YYYY-MM-DD",
          "label": "기간 라벨 (선택)",
          "color": "#HexColor",  // 기간별 색상 (선택)
          "dependencies": ["target_id"] // 기간별 의존성 (선택)
        }
      ],

      "milestones": [            // 마일스톤이 있을 경우
        {
          "id": "ms_id_1",
          "date": "YYYY-MM-DD",
          "label": "마일스톤 이름",
          "shape": "star",       // star, diamond, flag, circle, square, triangle 중 택 1
          "color": "#HexColor",
          "labelPosition": "top", // top, bottom, right 중 택 1
          "dependencies": ["target_id"] // 마일스톤 의존성 (선택)
        }
      ],

      "dependencies": ["target_id_1"], // (Legacy) 작업 수준 의존성

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

**업데이트된 기능 (New Features)**:
1. **타임 레인지 (Time Ranges)**: 이제 하나의 작업이 여러 개의 분리된 기간(\`timeRanges\`)을 가질 수 있습니다. (예: 개발 1차, 개발 2차)
2. **상세 의존성**: 작업 간 연결뿐만 아니라, 특정 '기간'이나 '마일스톤' 간의 연결이 가능합니다.
3. **기간 라벨**: 각 기간마다 별도의 라벨을 붙여 "Toolbar > 기간표시" 기능에서 확인할 수 있습니다.

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
"위의 JSON 구조와 생성 규칙을 완벽히 이해했나요?
이해했다면, 이제부터 제가 입력하는 자연어 설명이나 시나리오를 바탕으로 즉시 JSON 데이터를 생성해주세요.
준비가 되었다면 '네, 일정을 말씀해 주세요!'라고만 짧게 대답하고 대기해주세요."`
            }
        ]
    }
];

function PromptGuideModal({ isOpen, onClose, toast }) {
    const handleCopy = (text) => {
        navigator.clipboard.writeText(text)
            .then(() => toast.success('프롬프트가 복사되었습니다! 📋'))
            .catch(() => toast.error('복사에 실패했습니다.'));
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><Bot size={17} aria-hidden="true" /> AI 프롬프트 가이드</>}
            className="prompt-guide-modal"
        >
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
        </Modal>
    );
}

export default PromptGuideModal;
