// 프로젝트 레지스트리 CRUD — /api/projects
const express = require('express');
const registry = require('../lib/registry');
const { validate } = require('../lib/validate');

const router = express.Router();

router.get('/projects', (req, res) => {
    res.json({ ok: true, projects: registry.listProjects() });
});

router.post('/projects', (req, res) => {
    const err = validate(req.body, { name: { type: 'string', required: true } });
    if (err) return res.status(400).json({ ok: false, error: err });
    if (!req.body.name.trim()) return res.status(400).json({ ok: false, error: 'name must not be empty' });
    const project = registry.createProject(req.body.name.trim(), req.user || 'local');
    res.status(201).json({ ok: true, project });
});

router.patch('/projects/:pid', (req, res) => {
    const err = validate(req.body, { name: { type: 'string', required: true } });
    if (err) return res.status(400).json({ ok: false, error: err });
    const project = registry.renameProject(req.params.pid, req.body.name.trim());
    if (!project) return res.status(404).json({ ok: false, error: 'project not found' });
    res.json({ ok: true, project });
});

router.delete('/projects/:pid', (req, res) => {
    const result = registry.deleteProject(req.params.pid);
    if (result.error === 'not found') return res.status(404).json({ ok: false, error: 'project not found' });
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true });
});

module.exports = router;
