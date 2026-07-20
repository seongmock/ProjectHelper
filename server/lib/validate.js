// 경량 요청 검증 — 외부 라이브러리 없이 필요한 필드 타입만 검사
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

const validators = {
    string: (v) => typeof v === 'string',
    bool: (v) => typeof v === 'boolean',
    int: (v) => Number.isInteger(v),
    date: (v) => typeof v === 'string' && DATE_RE.test(v) && !isNaN(Date.parse(v)),
    color: (v) => typeof v === 'string' && HEX_RE.test(v),
    stringArray: (v) => Array.isArray(v) && v.every(s => typeof s === 'string'),
    object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

const isEnum = (values) => (v) => values.includes(v);

// spec: { fieldName: { type: 'date'|'string'|..., required?: true, enum?: [...], nullable?: true } }
// body의 각 필드를 spec에 따라 검사. 미지의 키는 allowUnknown=false면 거부.
// 반환: 오류 메시지 문자열 또는 null(통과)
const validate = (body, spec, { allowUnknown = false } = {}) => {
    if (!validators.object(body)) return 'request body must be a JSON object';

    for (const [field, rule] of Object.entries(spec)) {
        const value = body[field];
        if (value === undefined) {
            if (rule.required) return `missing required field: ${field}`;
            continue;
        }
        if (value === null) {
            if (rule.nullable) continue;
            return `field '${field}' must not be null`;
        }
        if (rule.enum) {
            if (!isEnum(rule.enum)(value)) {
                return `field '${field}' must be one of: ${rule.enum.join(', ')}`;
            }
            continue;
        }
        const check = validators[rule.type];
        if (!check) return `unknown validator type for field: ${field}`;
        if (!check(value)) return `field '${field}' must be a valid ${rule.type}`;
    }

    if (!allowUnknown) {
        const unknown = Object.keys(body).filter(k => !(k in spec));
        if (unknown.length > 0) return `unknown field(s): ${unknown.join(', ')}`;
    }
    return null;
};

module.exports = { validate, validators };
