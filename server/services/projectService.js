// 프로젝트 레지스트리 도메인 로직 — registry 모듈의 반환값 규약(null / {error})을
// AppError로 통일해 라우트가 분기하지 않도록 한다.
const registry = require('../lib/registry');
const { validate } = require('../lib/validate');
const { badRequest, notFound } = require('../lib/errors');

// 이름은 레지스트리(projects.json)와 레일 배지에 그대로 실린다 — 상한이 없으면
// 요청 하나가 레지스트리 파일을 임의 크기로 부풀리고, 그 파일은 모든 읽기 경로가 판다.
const MAX_NAME = 200;
// 프로젝트마다 디렉토리·meta·events.jsonl 이 생긴다. 삭제는 _trash 로 옮길 뿐이라
// 되돌아오지 않는 디스크 사용이다.
const MAX_PROJECTS = 200;

const NAME_SPEC = { name: { type: 'string', required: true, max: MAX_NAME } };

const assertName = (body) => {
    const err = validate(body, NAME_SPEC);
    if (err) throw badRequest(err);
    const name = body.name.trim();
    if (!name) throw badRequest('name must not be empty');
    return name;
};

const listProjects = () => ({ projects: registry.listProjects() });

const createProject = (body, owner = 'local') => {
    const name = assertName(body);
    if (registry.listProjects().length >= MAX_PROJECTS) {
        throw badRequest(`project count exceeds limit of ${MAX_PROJECTS}`);
    }
    return { project: registry.createProject(name, owner) };
};

const renameProject = (pid, body) => {
    const project = registry.renameProject(pid, assertName(body));
    if (!project) throw notFound('project');
    return { project };
};

const deleteProject = (pid) => {
    const result = registry.deleteProject(pid);
    if (result.error === 'not found') throw notFound('project');
    if (result.error) throw badRequest(result.error); // 예: 마지막 프로젝트는 삭제 불가
    return {};
};

module.exports = { listProjects, createProject, renameProject, deleteProject };
