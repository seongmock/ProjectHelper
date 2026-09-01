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
        category: "📋 프롬프트를 복사해 붙여넣기 (수동 — 받은 JSON 은 [가져오기]로)",
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

// 세션에 그대로 붙여넣을 문장. **프로젝트 id 를 문장에 박는 것이 핵심이다** — API 도구는
// projectId 를 생략하면 'default' 프로젝트에 쓰므로, 지금 보고 있는 것이 아니라 엉뚱한
// 프로젝트가 바뀐다. 사용법 본문은 여기에 적지 않는다: /api/guide 가 단일 출처이고,
// 그것을 JSX 에 옮겨 적은 사본은 드리프트한다.
const buildSessionPrompt = (apiBase, projectId, projectName) => [
    'ProjectHelper 타임라인 API 로 작업해 줘.',
    `- API 베이스: ${apiBase}`,
    `- 프로젝트 id: ${projectId || '‹프로젝트를 먼저 선택하세요›'}${projectName ? ` (${projectName})` : ''}`,
    `- 사용법은 GET ${apiBase}/guide 를 먼저 읽어. 전체 스펙은 GET ${apiBase}/openapi.yaml.`,
    '- 쓰기는 작업 단위 엔드포인트를 쓰고, 통짜 POST /data 는 쓰지 마.',
    '',
    '요청: ‹여기에 하고 싶은 일을 적으세요›',
].join('\n');

const API_EXAMPLES = [
    '"RTL Stable 마일스톤을 2주 미루고, 후행 작업도 주말 피해서 같이 밀어줘"',
    '"지금 일정의 임계경로와 여유 없는 작업을 알려줘"',
    '"의존성에 순환이나 날짜 역전이 있는지 점검해줘"',
    '"전체 일정을 텍스트 간트로 보여줘"',
];

function PromptGuideModal({ isOpen, onClose, toast, projectId, projectName, authStatus }) {
    // http 로 열면 `navigator.clipboard` 자체가 없다(보안 컨텍스트 전용) — 그 경우
    // `.writeText` 는 **동기적으로** TypeError 를 던지므로 .catch() 로는 안 잡히고,
    // 버튼이 아무 반응 없이 죽었다. Docker 없이 뜨는 HTTP:8080 폴백이 그 상태다.
    const handleCopy = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success('프롬프트가 복사되었습니다! 📋');
        } catch {
            toast.error('복사에 실패했습니다. HTTPS 가 아니면 브라우저가 클립보드를 막습니다 — 아래 글을 직접 선택해 복사하세요.');
        }
    };

    // 링크로도 쓰이므로 절대 주소여야 한다 — storage.js 의 '/api' 는 상대 경로다.
    const apiBase = `${window.location.origin}/api`;
    const sessionPrompt = buildSessionPrompt(apiBase, projectId, projectName);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><Bot size={17} aria-hidden="true" /> AI 가이드</>}
            className="prompt-guide-modal"
        >
            <p className="guide-description">
                AI 에게 일정을 맡기는 방법은 두 가지입니다 — <strong>API 로 직접 맡기거나</strong>,
                프롬프트를 복사해 붙여넣고 결과를 가져오거나.
            </p>

            <div className="prompt-categories">
                <div className="prompt-category">
                    <h3>🤖 AI 가 직접 편집하게 하기 (API)</h3>
                    <p className="api-intro">
                        이 화면의 데이터는 REST API 로 열려 있습니다. Claude Code 같은 AI 세션에
                        아래 문장을 붙여넣으면 복사·가져오기 없이 AI 가 직접 읽고 고치며,
                        바뀐 내용은 열려 있는 화면에 자동으로 반영됩니다.
                    </p>
                    {/* 인증 상태는 주소와 같은 자리에서 말한다. 'open' 은 서버에 닿지 못할 때도
                        나오는 값이라, 배포 상태를 단정하지 않는 문구를 쓴다. */}
                    {authStatus === 'open' && (
                        <p className="api-auth-note" data-testid="ai-auth-note">
                            지금 이 서버는 로그인 계정이 없는 상태로 열려 있습니다 — 주소에 닿을 수
                            있는 사람은 누구나 읽고 쓸 수 있습니다.
                        </p>
                    )}
                    <div className="prompt-item">
                        <div className="prompt-header">
                            <span className="prompt-title">세션에 붙여넣을 문장</span>
                            <button
                                className="copy-button"
                                onClick={() => handleCopy(sessionPrompt)}
                            >
                                복사
                            </button>
                        </div>
                        <div className="prompt-preview" data-testid="ai-session-prompt">
                            {sessionPrompt}
                        </div>
                    </div>
                    <ul className="api-examples">
                        {API_EXAMPLES.map((example, idx) => <li key={idx}>{example}</li>)}
                    </ul>
                    <div className="api-links">
                        <a
                            href={`${apiBase}/guide`}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="ai-guide-link"
                        >
                            API 가이드 열기 →
                        </a>
                        <a href={`${apiBase}/openapi.yaml`} target="_blank" rel="noopener noreferrer">
                            전체 스펙 (OpenAPI) →
                        </a>
                    </div>
                </div>

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
