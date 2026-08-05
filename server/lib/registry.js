// 프로젝트 레지스트리 — data/projects.json 관리 + 레거시 레이아웃 마이그레이션
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { logger } = require('./logger');

const REGISTRY_FILE = path.join(store.DATA_DIR, 'projects.json');
const TRASH_DIR = path.join(store.PROJECTS_DIR, '_trash');

const generateProjectId = () =>
    `proj-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

const readRegistry = () => store.readJsonSafe(REGISTRY_FILE) || [];
const writeRegistry = (projects) => store.writeJsonAtomic(REGISTRY_FILE, projects);

const listProjects = () => readRegistry();

const getProject = (pid) => readRegistry().find(p => p.id === pid) || null;

const createProject = (name, owner = 'local') => {
    const now = new Date().toISOString();
    const project = { id: generateProjectId(), name: String(name), owner, createdAt: now, updatedAt: now };
    writeRegistry([...readRegistry(), project]);
    store.getProjectStore(project.id).writeTasks([]); // 디렉토리 + 빈 데이터 + meta 생성
    return project;
};

const renameProject = (pid, name) => {
    const projects = readRegistry();
    const target = projects.find(p => p.id === pid);
    if (!target) return null;
    target.name = String(name);
    target.updatedAt = new Date().toISOString();
    writeRegistry(projects);
    return target;
};

// 삭제: 완전 삭제 대신 _trash/로 이동 (안전망). 마지막 프로젝트는 삭제 불가.
const deleteProject = (pid) => {
    const projects = readRegistry();
    if (projects.length <= 1) return { error: 'cannot delete the last project' };
    const target = projects.find(p => p.id === pid);
    if (!target) return { error: 'not found' };

    const dir = store.projectDir(pid);
    if (fs.existsSync(dir)) {
        if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
        fs.renameSync(dir, path.join(TRASH_DIR, `${pid}-${Date.now()}`));
    }
    writeRegistry(projects.filter(p => p.id !== pid));
    return { ok: true };
};

// 레거시(단일 data.json) → 프로젝트 레이아웃 마이그레이션 (멱등, 부팅 시 1회 호출)
const ensureLayout = () => {
    if (!fs.existsSync(store.PROJECTS_DIR)) fs.mkdirSync(store.PROJECTS_DIR, { recursive: true });

    const defaultDir = store.projectDir('default');
    if (!fs.existsSync(defaultDir)) {
        fs.mkdirSync(defaultDir, { recursive: true });
        // 레거시 파일이 있으면 default 프로젝트로 이동
        for (const f of ['data.json', 'meta.json', 'snapshots.json']) {
            const legacy = path.join(store.DATA_DIR, f);
            if (fs.existsSync(legacy)) fs.renameSync(legacy, path.join(defaultDir, f));
        }
        if (!fs.existsSync(path.join(defaultDir, 'data.json'))) {
            store.writeJsonAtomic(path.join(defaultDir, 'data.json'), []);
        }
        logger.info('legacy data migrated', { to: 'projects/default/' });
    }

    // 레지스트리에 default 보장
    const projects = readRegistry();
    if (!projects.some(p => p.id === 'default')) {
        const now = new Date().toISOString();
        writeRegistry([{ id: 'default', name: '기본 프로젝트', owner: 'local', createdAt: now, updatedAt: now }, ...projects]);
    }
};

module.exports = { listProjects, getProject, createProject, renameProject, deleteProject, ensureLayout };
