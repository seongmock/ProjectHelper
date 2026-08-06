// Service 결과 → HTTP 응답 변환. 라우트에서 반복되던 try/응답조립을 한 곳에 모은다.
//
// 핸들러는 `req`를 받아 응답 본문 객체를 반환하거나 AppError를 던진다.
// 성공: { ok: true, ...반환값 } / 실패: { ok: false, error, revision? }
//
// 오류 응답에 revision을 실어 보내는 것은 기존 API 계약이다 — 클라이언트가 409를
// 받았을 때 재조회 없이 서버 리비전을 알 수 있어야 한다. 프로젝트 스코프가 없는
// 라우트(/api/projects 등)에는 revision이 없으므로 생략한다.
const { AppError } = require('./errors');

const currentRevision = (req) => {
    if (!req.projectStore) return {};
    try {
        return { revision: req.projectStore.readMeta().revision };
    } catch {
        return {};
    }
};

const route = (handler, successStatus = 200) => (req, res, next) => {
    let result;
    try {
        result = handler(req);
    } catch (err) {
        if (!(err instanceof AppError)) return next(err); // 예상 못한 오류는 전역 핸들러로
        return res.status(err.status).json({
            ok: false,
            error: err.message,
            ...currentRevision(req),
        });
    }
    res.status(successStatus).json({ ok: true, ...result });
};

module.exports = { route };
