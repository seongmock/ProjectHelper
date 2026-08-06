// 프로젝트 레지스트리 CRUD — /api/projects
// HTTP 어댑터만 담당한다 — 검증·오류 판정은 services/projectService 에 있다.
const express = require('express');
const svc = require('../services/projectService');
const { route } = require('../lib/httpAdapter');

const router = express.Router();

router.get('/projects', route(() => svc.listProjects()));

router.post('/projects', route((req) => svc.createProject(req.body, req.user || 'local'), 201));

router.patch('/projects/:pid', route((req) => svc.renameProject(req.params.pid, req.body)));

router.delete('/projects/:pid', route((req) => svc.deleteProject(req.params.pid)));

module.exports = router;
