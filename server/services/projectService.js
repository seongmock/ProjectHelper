// 프로젝트 레지스트리 도메인 로직 — registry 모듈의 반환값 규약(null / {error})을
// AppError로 통일해 라우트가 분기하지 않도록 한다.
const registry = require('../lib/registry');
const { validate } = require('../lib/validate');
const { badRequest, notFound } = require('../lib/errors');

const NAME_SPEC = { name: { type: 'string', required: true } };

const assertName = (body) => {
    const err = validate(body, NAME_SPEC);
    if (err) throw badRequest(err);
    const name = body.name.trim();
    if (!name) throw badRequest('name must not be empty');
    return name;
};

const listProjects = () => ({ projects: registry.listProjects() });

const createProject = (body, owner = 'local') => ({
    project: registry.createProject(assertName(body), owner),
});

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
