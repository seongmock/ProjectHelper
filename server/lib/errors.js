// 도메인 오류 → HTTP 상태 매핑을 한 곳으로 모은다.
//
// 왜 필요한가: Service 계층은 HTTP를 몰라야 한다. 그래야 express 없이 직접 호출해
// 단위 테스트할 수 있다. 서비스는 AppError만 던지고, 상태코드/응답 형태 변환은
// lib/httpAdapter.js 가 한 번만 수행한다.
class AppError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'AppError';
        this.status = status;
    }
}

const badRequest = (message) => new AppError(400, message);
const notFound = (what = 'task') => new AppError(404, `${what} not found`);
const conflict = (message = 'revision mismatch') => new AppError(409, message);

module.exports = { AppError, badRequest, notFound, conflict };
